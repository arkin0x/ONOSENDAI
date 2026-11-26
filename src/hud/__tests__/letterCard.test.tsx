/**
 * letterCard.test.tsx: a hidden message opened as a sealed letter (owner,
 * 2026-11-26: "decode effect for the message itself. love the broken seal
 * for read"). Every time the card opens the words decode out of glyphs,
 * slowly the first time and quickly after; a tap on the page skips to the
 * words; the real words hold the height from the first frame; reduced motion
 * skips it all; opening the card is what reads the message. And the seal in
 * the lists: whole until read, broken after.
 *
 * Mounted for real (test/elementRoot.ts), the clock held by the test. No network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}
;(globalThis as { window?: unknown }).window ??= globalThis
vi.mock('../../lib/relay', () => ({
  onAuthChange: () => () => {},
  signInFailed: () => false,
  publish: vi.fn(async () => ({ ok: true })),
  publishMany: vi.fn(async () => ({ ok: true })),
  publishLight: vi.fn(async () => true),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  queryAnyChecked: vi.fn(async () => ({ events: [], trouble: null })),
  queryChecked: vi.fn(async () => ({ events: [], trouble: null })),
  queryEach: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { mount, settled, textOf, type Host, type Mounted } from '../../test/elementRoot'
import { glyphRuns, LetterCard } from '../LetterCard'
import { LetterThumb, Seal } from '../LetterSeal'
import { useMessagesRead } from '../../store/useMessagesRead'
import { DECODE_AGAIN_MS, DECODE_FIRST_MS, UNFOLD_AGAIN_MS, UNFOLD_FIRST_MS } from '../../lib/letterReveal'
import { isRead } from '../../lib/messagesRead'

const AUTHOR = 'cd'.repeat(32)
const SHORT = 'The door on the north wall opens.'
const LONG = 'I stood here the night the relay went quiet. Nothing moved for an hour, then the whole lattice lit up at once, every cell answering every other cell, like a city waking.'
const item = (text: string, key = 'm1') => ({ key, text, event: { tags: [] } })

let now = 1000
let m: Mounted | null = null
beforeEach(() => {
  now = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  useMessagesRead.setState({ owner: 'me', read: { ids: [] }, ready: true })
  delete (globalThis as { matchMedia?: unknown }).matchMedia
})
afterEach(async () => {
  await m?.unmount()
  m = null
  vi.restoreAllMocks()
})

const byClass = (r: Mounted, c: string): Host[] => r.all().filter((h) => typeof h.props.className === 'string' && (h.props.className as string).split(' ').includes(c))
/** The words drawn over the real ones while they decode, or null once they are whole. */
const overlay = (r: Mounted): string | null => { const [h] = byClass(r, 'letter__shown'); return h ? textOf(h) : null }
const ghost = (r: Mounted): string => textOf(byClass(r, 'letter__ghost')[0])
/** Move the clock and let a few frames run. */
async function at(ms: number): Promise<void> { now = 1000 + ms; await new Promise((r) => setTimeout(r, 50)); await settled(4) }

describe('opening a letter', () => {
  it('the first time: glyphs through the unfold, the words resolving over about 1.1 s, then whole', async () => {
    m = await mount(createElement(LetterCard, { item: item(SHORT), author: AUTHOR, mine: false }))
    expect(byClass(m, 'letter--opening')).toHaveLength(1)
    // The real words hold the height from the first frame.
    expect(ghost(m)).toBe(SHORT)
    const first = overlay(m)!
    expect(first).toHaveLength(SHORT.length)
    expect(first).not.toBe(SHORT)
    // Spaces stay put, so the shape of the message shows before its words do.
    expect([...first].map((c, i) => (c === ' ') === (SHORT[i] === ' ')).every(Boolean)).toBe(true)
    await at(UNFOLD_FIRST_MS + DECODE_FIRST_MS / 2)
    expect(overlay(m)).not.toBeNull()
    await at(UNFOLD_FIRST_MS + DECODE_FIRST_MS + 1)
    expect(overlay(m)).toBeNull()
    expect(ghost(m)).toBe(SHORT)
  })

  it('reads the message: its seal is broken from then on', async () => {
    expect(isRead(useMessagesRead.getState().read, 'm1')).toBe(false)
    m = await mount(createElement(LetterCard, { item: item(SHORT), author: AUTHOR, mine: false }))
    expect(isRead(useMessagesRead.getState().read, 'm1')).toBe(true)
  })

  it('decodes again every time it opens, quickly once read', async () => {
    m = await mount(createElement(LetterCard, { item: item(SHORT), author: AUTHOR, mine: false }))
    await m.unmount()
    now = 1000
    m = await mount(createElement(LetterCard, { item: item(SHORT), author: AUTHOR, mine: false }))
    // It decodes again...
    expect(overlay(m)).not.toBeNull()
    // ...and is done in about 0.3 s, well before the first time's 1.1 s.
    await at(UNFOLD_AGAIN_MS + DECODE_AGAIN_MS + 1)
    expect(overlay(m)).toBeNull()
    expect(UNFOLD_AGAIN_MS + DECODE_AGAIN_MS).toBeLessThan(UNFOLD_FIRST_MS + DECODE_FIRST_MS / 2)
  })

  it('a tap on the page skips straight to the words, the seal broken', async () => {
    m = await mount(createElement(LetterCard, { item: item(LONG), author: AUTHOR, mine: false }))
    expect(overlay(m)).not.toBeNull()
    ;(byClass(m, 'letter__page')[0].props.onPointerDown as () => void)()
    await settled(2)
    expect(overlay(m)).toBeNull()
    expect(byClass(m, 'letter--opening')).toHaveLength(0)
    expect(byClass(m, 'seal--broken')).toHaveLength(1)
  })

  it('a key on the page skips too', async () => {
    m = await mount(createElement(LetterCard, { item: item(SHORT), author: AUTHOR, mine: false }))
    ;(byClass(m, 'letter__page')[0].props.onKeyDown as (e: unknown) => void)({ key: 'Enter', preventDefault: () => {} })
    await settled(2)
    expect(overlay(m)).toBeNull()
  })

  it('with reduced motion nothing moves: no crack, no unfold, the words whole at once', async () => {
    ;(globalThis as { matchMedia?: unknown }).matchMedia = (q: string) => ({ matches: q.includes('reduce'), addEventListener: () => {}, removeEventListener: () => {} })
    m = await mount(createElement(LetterCard, { item: item(SHORT), author: AUTHOR, mine: false }))
    expect(byClass(m, 'letter--opening')).toHaveLength(0)
    expect(overlay(m)).toBeNull()
    expect(byClass(m, 'seal--broken')).toHaveLength(1)
  })

  it('sets a short message large, and a long one in a fixed-height reading view with a fade and a line for how far through', async () => {
    m = await mount(createElement(LetterCard, { item: item(SHORT), author: AUTHOR, mine: false }))
    expect(byClass(m, 'letter__words--short')).toHaveLength(1)
    expect(byClass(m, 'letter__read')).toHaveLength(0)
    await m.unmount()
    m = await mount(createElement(LetterCard, { item: item(LONG, 'm2'), author: AUTHOR, mine: false }))
    expect(byClass(m, 'letter__words--short')).toHaveLength(0)
    expect(byClass(m, 'letter__read')).toHaveLength(1)
    expect(byClass(m, 'letter__progress')).toHaveLength(1)
  })

  it('draws the glyphs apart from the letters already resolved, in few runs', () => {
    expect(glyphRuns('abXYe', 'abcde')).toEqual([{ text: 'ab', glyph: false }, { text: 'XY', glyph: true }, { text: 'e', glyph: false }])
    expect(glyphRuns('abc', 'abc')).toEqual([{ text: 'abc', glyph: false }])
  })
})

describe('the seal', () => {
  it('whole bears the initial; broken is two halves and no initial', () => {
    const whole = renderToStaticMarkup(createElement(Seal, { colour: '#ffcf6b', initial: 'M', broken: false }))
    expect(whole).toContain('seal--whole')
    expect(whole).toContain('>M</text>')
    expect(whole).toContain('fill="#ffcf6b"')
    const broken = renderToStaticMarkup(createElement(Seal, { colour: '#ffcf6b', initial: 'M', broken: true }))
    expect(broken).toContain('seal--broken')
    expect(broken.match(/seal__half--/g)).toHaveLength(2)
    expect(broken).not.toContain('>M</text>')
  })

  it('in a list: the folded letter in the 80px chamfered frame, its seal whole until read and broken after', () => {
    const unread = renderToStaticMarkup(createElement(LetterThumb, { colour: '#7cc8ff', initial: 'C', broken: false }))
    expect(unread).toContain('--chamfer-size:80px')
    expect(unread).toContain('seal--whole')
    expect(unread).not.toContain('letterthumb--read')
    const read = renderToStaticMarkup(createElement(LetterThumb, { colour: '#7cc8ff', initial: 'C', broken: true }))
    expect(read).toContain('seal--broken')
    expect(read).toContain('letterthumb--read')
  })
})
