/**
 * hudEdges.test.ts - on a wide screen the HUD stands at the screen's edges,
 * and slides inboard of the open menu's columns (owner, 2026-11-22: "the
 * controls on the left and right actually be adjacent to the edges of the
 * screen on wider devices ... if the menu is opened, the controls go inward
 * so they aren't covered by the menu"; then "everything: the chips and 3d
 * compass and menu button too", and "the directional pad in any mode").
 *
 * Three parts: the columns' reach is measured (hooks/useMenuInset), the
 * stylesheet turns it into a shift for each side, and every control carries
 * its side's shift as a transitioned `translate`. The shift formula is
 * evaluated here from the stylesheet's own text, so the numbers below are
 * what the browser computes, not a copy of them.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { measureMenuCover, setPaintedForTest, SLIDE_ATTR, SLIDE_MS, watchMenuInset, type InsetHost } from '../../hooks/useMenuInset'

const CSS = readFileSync(join(__dirname, '..', '..', 'styles.css'), 'utf8')
const HUD = readFileSync(join(__dirname, '..', 'Hud.tsx'), 'utf8')

/** The bodies of every `@media (min-width: 1101px)` block, braces balanced. */
function desktopBlocks(): string[] {
  const out: string[] = []
  const head = '@media (min-width: 1101px) {'
  for (let at = CSS.indexOf(head); at !== -1; at = CSS.indexOf(head, at + 1)) {
    let depth = 0
    let i = at + head.length - 1
    for (; i < CSS.length; i++) {
      if (CSS[i] === '{') depth++
      else if (CSS[i] === '}' && --depth === 0) break
    }
    out.push(CSS.slice(at + head.length, i))
  }
  return out
}

/** The last value a desktop block gives the custom property `name`. */
function desktopVar(name: string): string {
  let last: string | null = null
  for (const block of desktopBlocks()) for (const m of block.matchAll(new RegExp(`${name}: ([^;]+);`, 'g'))) last = m[1]
  expect(last, name).not.toBeNull()
  return last as string
}

/** A :root custom property's value outside any media query (the first declaration). */
function baseVar(name: string): string {
  const m = CSS.match(new RegExp(`\\n  ${name}: ([^;]+);`))
  expect(m, name).not.toBeNull()
  return (m as RegExpMatchArray)[1]
}

/**
 * Evaluates a CSS length expression of px, calc(), max() and var()s, with
 * the given custom property values and every env() inset at `inset`.
 */
function px(expr: string, vars: Record<string, string>, inset = 0): number {
  let e = expr
  for (let i = 0; i < 10 && /var\(/.test(e); i++) {
    e = e.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g, (_, n: string, fb?: string) => `(${vars[n] ?? fb ?? 'NaN'})`)
  }
  e = e.replace(/env\([^)]*\)/g, `${inset}px`).replace(/calc\(/g, '(').replace(/max\(/g, 'Math.max(').replace(/(\d+(?:\.\d+)?)px/g, '$1')
  expect(e).toMatch(/^[\d\s.+\-*/()Mathmax,]+$/)
  return Function(`return (${e})`)() as number
}

function shifts(coverL: string | null, coverR: string | null, inset = 0): { l: number; r: number; edgeL: number; edgeR: number } {
  const vars: Record<string, string> = {
    '--hud-edge-l': baseVar('--hud-edge-l'),
    '--hud-edge-r': baseVar('--hud-edge-r'),
  }
  if (coverL !== null) vars['--hud-cover-l'] = coverL
  if (coverR !== null) vars['--hud-cover-r'] = coverR
  return {
    l: px(desktopVar('--hud-shift-l'), vars, inset),
    r: px(desktopVar('--hud-shift-r'), vars, inset),
    edgeL: px(vars['--hud-edge-l'], vars, inset),
    edgeR: px(vars['--hud-edge-r'], vars, inset),
  }
}

/** The selectors of every rule (outside media queries) that declares `decl`. */
function selectorsWith(decl: string): string[] {
  const out: string[] = []
  for (const m of CSS.matchAll(/\n([^{}\n@][^{}]*)\{([^{}]*)\}/g)) {
    if (m[2].includes(decl)) out.push(...m[1].split(',').map((s) => s.trim()))
  }
  return out
}

describe('the edges on a wide screen', () => {
  it('every corner number is the edge, 16px past any safe-area inset, not the old 332px and 352px', () => {
    expect(desktopVar('--menu-left')).toBe('var(--hud-edge-l)')
    expect(desktopVar('--instruments-left')).toBe('var(--hud-edge-l)')
    expect(desktopVar('--controls-right')).toBe('var(--hud-edge-r)')
    expect(desktopVar('--compass-right')).toBe('var(--hud-edge-r)')
    expect(shifts(null, null).edgeL).toBe(16)
    expect(shifts(null, null, 30).edgeL).toBe(46)
    expect(shifts(null, null, 30).edgeR).toBe(46)
    // Nothing still stands at the old inset, and the scene-centred chips centre on the screen.
    expect(CSS).not.toMatch(/(left|right): 33[0-9]px|(left|right): 35[0-9]px|left: 424px|right: 470px|50% \+ 10px/)
  })

  it('closed, nothing shifts; open, each side shifts to stand 16px inside its column', () => {
    expect(shifts(null, null)).toMatchObject({ l: 0, r: 0 })
    // The columns as the browser measured them at 2000px: 16px + 320px, 16px + 300px.
    const open = shifts('336px', '316px')
    expect(open.edgeL + open.l).toBe(336 + 16)
    expect(open.edgeR + open.r).toBe(316 + 16)
    // From the measured reach, not a written width: a wider column moves them further.
    expect(shifts('400px', '380px')).toMatchObject({ l: 400, r: 380 })
    // A notch already past the column's gap moves nothing back out.
    expect(shifts('0px', '0px', 30)).toMatchObject({ l: 0, r: 0 })
  })

  it('the shifts exist only from 1101px: on a phone the menu covers the scene and nothing slides', () => {
    expect(baseVar('--hud-shift-l')).toBe('0px')
    expect(baseVar('--hud-shift-r')).toBe('0px')
  })
})

describe('every control slides with its side', () => {
  const left = selectorsWith('translate: var(--hud-shift-l) 0;')
  const right = selectorsWith('translate: calc(-1 * var(--hud-shift-r)) 0;')
  const centre = selectorsWith('translate: var(--hud-skew) 0;')

  it('the left side: the menu button, the instrument chips, the walk pad, the fly and scan docks, the route overlay and deploy bar, the HOSAKA mark', () => {
    for (const s of ['.hamburger-menu', '.instruments', '.touchpad--mode-walk', '.flyorbs', '.routeov', '.deploybar', '.hosaka-pulse']) expect(left, s).toContain(s)
  })

  it('the right side: the pad in HOP, VIEW, BUILD and SCAN, the commit block, JUMP and DOWN, the LOOK ball, the compass and its menu', () => {
    for (const s of ['.touchpad:not(.touchpad--mode-walk)', '.touchops', '.walkside', '.orbsquare.walklook', '.compass-3d:not(.compass-3d--bench)', '.viewmenu', '.touchhint', '.spectate']) expect(right, s).toContain(s)
  })

  it('the workshop\'s compass stays in its view ball', () => {
    expect([...left, ...right, ...centre].some((s) => s.includes('.compass-3d') && !s.includes(':not(.compass-3d--bench)'))).toBe(false)
  })

  it('the chat between them moves its centre by half the difference and gives up half the sum on each side', () => {
    for (const s of ['.chatdock', '.chatdock__chip', '.starname']) expect(centre, s).toContain(s)
    expect(baseVar('--hud-mid')).toBe('calc((var(--hud-shift-l) + var(--hud-shift-r)) / 2)')
    expect(baseVar('--hud-skew')).toBe('calc((var(--hud-shift-l) - var(--hud-shift-r)) / 2)')
    expect(CSS).toContain('left: calc(var(--menu-left) + var(--menu-size) + 26px + var(--hud-mid));')
    expect(CSS).toContain('right: calc(var(--controls-right) + var(--controls-width) + 16px + var(--hud-mid));')
  })

  it('what spans the scene gives up the columns\' width, so its far edge stays clear', () => {
    expect(CSS).toContain('right: calc(var(--controls-right) + var(--controls-width) + var(--routeov-gap) + var(--hud-shift-l) + var(--hud-shift-r));')
    expect(CSS).toContain('max-width: calc(100vw - var(--instruments-left) - var(--compass-reserve) - var(--hud-shift-l) - var(--hud-shift-r));')
  })

  it('the slide is a transition of `translate` only, composited, only while the root allows it, and none under reduced motion', () => {
    expect(baseVar('--hud-slide')).toMatch(/^translate \d+ms /)
    // Never on the bare controls: a mode change swaps the pad's side, and a page load starts it inside the columns.
    const unGated = [...CSS.matchAll(/\n([^{}\n@][^{}]*)\{([^{}]*)\}/g)].filter((m) => m[2].includes('var(--hud-slide)') && !m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim().startsWith(':root[data-hud-slide]'))
    expect(unGated.map((m) => m[1].trim())).toEqual([])
    const gated = CSS.slice(CSS.indexOf(':root[data-hud-slide] :is('), CSS.indexOf('transition: var(--hud-slide);'))
    for (const s of ['.instruments', '.touchops', '.compass-3d:not(.compass-3d--bench)', '.chatdock__chip', '.orbsquare.walklook']) expect(gated, s).toContain(`  ${s},`)
    // The three that already eased something keep it and add the slide.
    expect(CSS).toContain(':root[data-hud-slide] .hamburger-menu { transition: background 0.2s ease, transform 0.2s ease, var(--hud-slide); }')
    expect(CSS).toContain(':root[data-hud-slide] :is(.touchpad, .walkside) { transition: bottom 160ms ease, var(--hud-slide); }')
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*:root \{ --hud-slide: translate 0s; \}/)
  })
})

describe('the columns\' reach', () => {
  /** A stand-in .hud: the measure reads only these. */
  const hud = (origin: number, cols: Record<string, { offsetLeft: number; offsetWidth: number } | null>) => ({
    getBoundingClientRect: () => ({ left: origin }),
    querySelector: (sel: string) => cols[sel.replace('.hud__col--', '')] ?? null,
  }) as unknown as HTMLElement

  it('is the left column\'s right edge from the left and the right column\'s left edge from the right', () => {
    expect(measureMenuCover(hud(0, { left: { offsetLeft: 16, offsetWidth: 320 }, right: { offsetLeft: 1684, offsetWidth: 300 } }), 2000)).toEqual({ left: 336, right: 316 })
  })

  it('a missing or hidden column reaches nowhere', () => {
    expect(measureMenuCover(hud(0, { left: null, right: { offsetLeft: 0, offsetWidth: 0 } }), 1440)).toEqual({ left: 0, right: 0 })
  })

  it('is measured only while the menu stands beside the scene, not while it covers a phone', () => {
    expect(HUD).toContain('useMenuInset(hudRef, !menuOpen)')
  })
})

describe('the watch', () => {
  /** A root, a window and a ResizeObserver that record what is done to them. */
  function host() {
    const props = new Map<string, string>()
    const attrs = new Set<string>()
    const listeners = new Set<() => void>()
    const timers = new Map<number, () => void>()
    const frames: (() => void)[] = []
    const observed: unknown[] = []
    let disconnected = 0
    let nextTimer = 1
    let width = 2000
    const root = {
      get clientWidth() { return width },
      style: { setProperty: (k: string, v: string) => { props.set(k, v) }, removeProperty: (k: string) => { props.delete(k) } },
      setAttribute: (k: string) => { attrs.add(k) },
      removeAttribute: (k: string) => { attrs.delete(k) },
    }
    const win = {
      addEventListener: (_: string, f: () => void) => { listeners.add(f) },
      removeEventListener: (_: string, f: () => void) => { listeners.delete(f) },
      setTimeout: (f: () => void) => { const id = nextTimer++; timers.set(id, f); return id },
      clearTimeout: (id: number) => { timers.delete(id) },
      requestAnimationFrame: (f: () => void) => { frames.push(f); return frames.length },
    }
    class Observer { constructor(public cb: () => void) {} observe(el: unknown) { observed.push(el) } disconnect() { disconnected++ } }
    const h = { root, win, Observer } as unknown as InsetHost
    return {
      h, props, attrs, listeners, observed, timers,
      disconnected: () => disconnected,
      resize: (w: number) => { width = w; for (const f of listeners) f() },
      frame: () => { for (const f of frames.splice(0)) f() },
      flush: () => { for (const [id, f] of [...timers]) { timers.delete(id); f() } },
    }
  }
  const cols = { left: { offsetLeft: 16, offsetWidth: 320 }, right: { offsetLeft: 1684, offsetWidth: 300 } }
  const hudEl = (right: { offsetLeft: number; offsetWidth: number }) => ({
    getBoundingClientRect: () => ({ left: 0 }),
    querySelector: (sel: string) => (sel.endsWith('left') ? cols.left : right),
    querySelectorAll: () => [cols.left, right],
  }) as unknown as HTMLElement

  it('writes both reaches on open, follows a resize, and takes everything away on close', () => {
    setPaintedForTest(true)
    const t = host()
    const right = { ...cols.right }
    const stop = watchMenuInset(hudEl(right), t.h)
    expect(Object.fromEntries(t.props)).toEqual({ '--hud-cover-l': '336px', '--hud-cover-r': '316px' })
    expect(t.observed).toHaveLength(2)
    expect(t.listeners.size).toBe(1)
    // The window narrows and the right column moves with it.
    right.offsetLeft = 1124
    t.resize(1440)
    expect(t.props.get('--hud-cover-r')).toBe('316px')
    expect(t.props.get('--hud-cover-l')).toBe('336px')
    stop()
    expect(t.props.size).toBe(0)
    expect(t.listeners.size).toBe(0)
    expect(t.disconnected()).toBe(1)
  })

  it('lets the slide run for a moment as the menu opens and as it closes, and not for a resize', () => {
    setPaintedForTest(true)
    const t = host()
    const stop = watchMenuInset(hudEl({ ...cols.right }), t.h)
    expect(t.attrs.has(SLIDE_ATTR)).toBe(true)
    // Nothing counts down until two frames have passed: the slide has begun by then.
    expect(t.timers.size).toBe(0)
    t.frame()
    expect(t.timers.size).toBe(0)
    t.frame()
    expect(t.timers.size).toBe(1)
    t.flush()
    expect(t.attrs.has(SLIDE_ATTR)).toBe(false)
    t.resize(1999)
    expect(t.attrs.has(SLIDE_ATTR)).toBe(false)
    stop()
    expect(t.attrs.has(SLIDE_ATTR)).toBe(true)
    t.frame(); t.frame(); t.flush()
    expect(t.attrs.has(SLIDE_ATTR)).toBe(false)
    expect(SLIDE_MS).toBeGreaterThan(240)
  })

  it('a close straight after an open keeps the slide allowed for the close', () => {
    setPaintedForTest(true)
    const t = host()
    const stop = watchMenuInset(hudEl({ ...cols.right }), t.h)
    t.frame(); t.frame()
    stop()
    // The open's countdown ends; the close's has not started.
    t.flush()
    expect(t.attrs.has(SLIDE_ATTR)).toBe(true)
    t.frame(); t.frame(); t.flush()
    expect(t.attrs.has(SLIDE_ATTR)).toBe(false)
  })

  it('a menu open as the page loads starts the controls inside the columns without a slide', () => {
    setPaintedForTest(false)
    const t = host()
    const stop = watchMenuInset(hudEl({ ...cols.right }), t.h)
    expect(t.props.get('--hud-cover-l')).toBe('336px')
    expect(t.attrs.has(SLIDE_ATTR)).toBe(false)
    stop()
    setPaintedForTest(true)
  })

  it('App arms the slide after its first commit', () => {
    expect(readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8')).toContain('useEffect(armMenuSlide, [])')
  })
})
