/**
 * CopyValue (owner, 2026-11-16: "I can't copy his sector or coordinate ...
 * I want those to be tap to copy"): a tap copies the WHOLE value, never the
 * shortened one shown; COPIED stands in its place for a moment, over the
 * value, which keeps its space; COULD NOT COPY when nothing worked. The HOP
 * card and the chain panel show their coord, sector and proof this way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis })

// The copier, watched: what a tap hands it is what lands on the clipboard.
const copied: string[] = []
let copyWorks = true
vi.mock('../../lib/copyText', () => ({
  copyText: (text: string) => { copied.push(text); return Promise.resolve(copyWorks) },
}))

// The component's hooks, run outside a renderer: its state is a spy, so a
// tap can be fired on the element it returns.
const flashes: unknown[] = []
vi.mock('react', async (orig) => {
  const real = await orig<typeof import('react')>()
  return {
    ...real,
    useState: (init: unknown) => [init, (v: unknown) => { flashes.push(v) }],
    useRef: (init: unknown) => ({ current: init }),
    useEffect: () => {},
  }
})

const { CopyValue, CopyValueView, copyAndFlash, COPIED_MS } = await import('../ui/CopyValue')

const COORD = 'cfe6b74c' + '0'.repeat(50) + '8254ef'
const SHORT = 'cfe6b74c…8254ef'
const SECTOR = '25200497907045552-36003453695486078-14837699276459992'

/** The props of the first element in a tree with an onClick. */
function clickable(node: ReactNode): { onClick: (e?: { stopPropagation: () => void }) => void } | null {
  if (!isValidElement(node)) return null
  const el = node as ReactElement<{ onClick?: () => void; children?: ReactNode }>
  if (typeof el.type === 'function') return clickable((el.type as (p: unknown) => ReactNode)(el.props))
  if (el.props.onClick) return el.props as never
  const kids = Array.isArray(el.props.children) ? el.props.children : [el.props.children]
  for (const k of kids) { const c = clickable(k); if (c) return c }
  return null
}

beforeEach(() => { copied.length = 0; flashes.length = 0; copyWorks = true; vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('CopyValue', () => {
  it('copies the whole coord when the shortened one is shown, and does not open the row it sits in', async () => {
    const tree = CopyValue({ value: COORD, shown: SHORT })
    const button = clickable(tree)
    expect(button).not.toBeNull()
    const stop = vi.fn()
    button!.onClick({ stopPropagation: stop })
    await vi.runAllTicks()
    await Promise.resolve()
    expect(copied).toEqual([COORD])
    expect(copied).not.toContain(SHORT)
    expect(stop).toHaveBeenCalled()
    expect(flashes).toContain('copied')
  })

  it('shows the short value, with the whole one in its tooltip, and a copy icon', () => {
    const html = renderToStaticMarkup(<CopyValueView value={COORD} shown={SHORT} flash={null} />)
    expect(html).toContain(SHORT)
    expect(html).toContain(`title="${COORD}\nTap to copy"`)
    expect(html).toContain('role="button"')
    expect(html).toMatch(/class="[^"]*copyv__icon/)
    expect(html).not.toContain('COPIED')
  })

  it('shows COPIED over the value, which stays (hidden) to keep its space', () => {
    const html = renderToStaticMarkup(<CopyValueView value={SECTOR} flash="copied" />)
    expect(html).toContain('<span class="copyv__flash" aria-hidden="true">COPIED</span>')
    expect(html).toContain('class="copyv is-flash"')
    expect(html).toContain(SECTOR)
  })

  it('says COULD NOT COPY when neither way worked', () => {
    expect(renderToStaticMarkup(<CopyValueView value={SECTOR} flash="failed" />)).toContain('COULD NOT COPY')
  })
})

describe('copyAndFlash', () => {
  it('flashes COPIED, then clears it after COPIED_MS', async () => {
    const set = vi.fn()
    const timer = { current: 0 }
    await copyAndFlash(SECTOR, set, timer, () => Promise.resolve(true))
    expect(set).toHaveBeenLastCalledWith('copied')
    vi.advanceTimersByTime(COPIED_MS - 1)
    expect(set).toHaveBeenLastCalledWith('copied')
    vi.advanceTimersByTime(1)
    expect(set).toHaveBeenLastCalledWith(null)
  })

  it('flashes failed when the copy did not happen', async () => {
    const set = vi.fn()
    await copyAndFlash(SECTOR, set, { current: 0 }, () => Promise.resolve(false))
    expect(set).toHaveBeenLastCalledWith('failed')
  })

  it('a second tap restarts the clock: the first tap never clears the newer COPIED', async () => {
    const set = vi.fn()
    const timer = { current: 0 }
    await copyAndFlash(SECTOR, set, timer, () => Promise.resolve(true))
    vi.advanceTimersByTime(COPIED_MS - 100)
    await copyAndFlash(SECTOR, set, timer, () => Promise.resolve(true))
    vi.advanceTimersByTime(200)
    expect(set).toHaveBeenLastCalledWith('copied')
    vi.advanceTimersByTime(COPIED_MS)
    expect(set).toHaveBeenLastCalledWith(null)
  })
})

describe('where the owner asked for it', () => {
  const src = (f: string): string => readFileSync(resolve(__dirname, '..', f), 'utf8')

  it('the HOP card copies its coord (whole, shown short) and its sector', () => {
    const s = src('ActionModal.tsx')
    expect(s).toContain('<CopyValue value={action.coordHex} shown={shortHex(action.coordHex, 8, 6)} />')
    expect(s).toContain('<CopyValue value={action.sector} />')
  })

  it('the chain panel copies coord, sector and proof, each whole', () => {
    const s = src('ChainExplorer.tsx')
    expect(s).toContain('<CopyValue value={action.coordHex} shown={shortHex(action.coordHex, 8, 6)} />')
    expect(s).toContain('<CopyValue value={action.sector} />')
    expect(s).toContain('<CopyValue value={action.proofHash} shown={shortHex(action.proofHash, 8, 6)} />')
  })
})
