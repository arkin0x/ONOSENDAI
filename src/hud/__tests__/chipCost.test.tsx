/**
 * chipCost.test.tsx: the CHAIN chip, its edge bar and the LOSING SYNC
 * warning stay cheap (arkinox, 2026-11-21: "Let's optimize the chip as much
 * as possible. I like the visual, but I don't want to sacrifice the
 * performance").
 *
 * | What | Held to |
 * |---|---|
 * | A step that changes the count | one render of the chip's button (ChainAhead.tsx AheadChip), none of the explorer around it |
 * | A store change that leaves the count alone (a frame, a cursor move) | no render at all |
 * | Any render | no state set during it: one call of the component per render |
 * | The warning under 15 | no render: it keeps the last count it showed |
 * | The stylesheet's motion for the chip, the bar and the warning | transform and opacity only, which the compositor plays without painting |
 *
 * Renders are counted by the hooks each component calls once per render:
 * the explorer asks useActionComments (stood in for here), the button and
 * the warning each ask useAheadSelect (watched here). A component that set
 * state during its render would be called twice for one change, and counted
 * twice.
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, settled, type Host } from '../../test/elementRoot'

vi.hoisted(() => {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
})
vi.mock('../../lib/workers', async (orig) => ({ ...(await orig() as object), postProof: () => {}, cancelProof: () => {} }))
// Nothing here may reach a relay.
vi.mock('../../lib/relay', async (orig) => ({ ...(await orig() as object), publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))
// Called once per render of the chain explorer: its render count.
vi.mock('../../hooks/useSocial', () => ({ useActionComments: vi.fn(() => ({ comments: [], loading: false, refresh: () => {} })) }))
// Called once per render of the chip's button and of the warning: theirs.
vi.mock('../../store/walkAhead', async (orig) => {
  const real = await orig() as typeof import('../../store/walkAhead')
  return { ...real, useAheadSelect: vi.fn(real.useAheadSelect) }
})

import { ChainExplorer } from '../ChainExplorer'
import { SyncWarning, useSyncWarnAside } from '../SyncWarning'
import { useActionComments } from '../../hooks/useSocial'
import { useChainUi } from '../../store/useChainUi'
import { useCyberspace } from '../../store/useCyberspace'
import { useWalk } from '../../store/useWalk'
import { useAheadSelect } from '../../store/walkAhead'

;(globalThis as { window?: unknown }).window ??= globalThis
;(globalThis as { document?: unknown }).document ??= { visibilityState: 'visible', addEventListener: () => undefined, removeEventListener: () => undefined }

const spawn = { id: 'e'.repeat(64), pubkey: 'p'.repeat(64), type: 'spawn', position: { x: 1n, y: 2n, z: 3n }, plane: 0, created_at: 1 }
const realChain = useCyberspace.getState().focusChain
const chainOf = (n: number): void => {
  const chain = Array.from({ length: n }, (_, i) => ({ ...spawn, id: i.toString(16).padStart(64, '0') }))
  useCyberspace.setState({ focusChain: () => chain as unknown as ReturnType<typeof realChain>, events: [] })
}
const walkAt = (behind: number): void => {
  useCyberspace.setState({ walking: true })
  useWalk.setState({ behind, open: null, queue: [], running: null })
}
const explorerRenders = (): number => vi.mocked(useActionComments).mock.calls.length
const aheadRenders = (): number => vi.mocked(useAheadSelect).mock.calls.length
const resetCounts = (): void => { vi.mocked(useActionComments).mockClear(); vi.mocked(useAheadSelect).mockClear() }
/** Mounted, and past the explorer's own first timer (its comment count waits 450 ms for the mark to rest), so what is counted after is the count's doing. */
async function mountChip(): Promise<Awaited<ReturnType<typeof mount>>> {
  const m = await mount(<ChainExplorer />)
  await new Promise((r) => setTimeout(r, 520))
  await settled()
  resetCounts()
  return m
}
const chipOf = (all: Host[]): Host => all.find((h) => h.type === 'button' && String(h.props.className).includes('explorer__toggle'))!
const litOf = (chip: Host): number => {
  const bar = chip.children.find((c): c is Host => typeof c !== 'string' && c.props.className === 'aheadbar')
  return (bar?.children ?? []).filter((t) => typeof t !== 'string' && String(t.props.className ?? '').split(' ').includes('is-lit')).length
}

afterEach(() => {
  useWalk.setState({ behind: 0, open: null, queue: [], running: null })
  useCyberspace.setState({ walking: false, focusChain: realChain, events: [], spectate: null, exploreIndex: null, forkNotice: null })
  useChainUi.setState({ explorerOpen: false })
  useSyncWarnAside.setState({ aside: false })
})

describe('the CHAIN chip renders for the count, and only for it', () => {
  it('renders its button once per count change, and the explorer around it not at all', async () => {
    chainOf(1253)
    walkAt(0)
    const m = await mountChip()
    for (let n = 1; n <= 26; n++) {
      walkAt(n)
      await settled()
      expect([n, litOf(chipOf(m.all()))]).toEqual([n, Math.min(20, n)])
      expect([n, aheadRenders()]).toEqual([n, n])
      expect([n, explorerRenders()]).toEqual([n, 0])
    }
    // And back down, one at a time, as moves are undone.
    resetCounts()
    for (let n = 25; n >= 1; n--) { walkAt(n); await settled() }
    expect(aheadRenders()).toBe(25)
    expect(explorerRenders()).toBe(0)
    await m.unmount()
  })

  it('renders nothing for a store change that leaves the count alone: a frame, a cursor move, the queue rewritten', async () => {
    chainOf(1253)
    walkAt(7)
    const m = await mountChip()
    for (let i = 0; i < 60; i++) {
      useCyberspace.setState({ position: { x: BigInt(i), y: 2n, z: 3n } } as never)
      useWalk.setState({ queue: [], running: null })
      useCyberspace.setState({ walking: true })
      await settled(2)
    }
    await settled()
    expect(aheadRenders()).toBe(0)
    expect(explorerRenders()).toBe(0)
    await m.unmount()
  })

  it('renders the explorer for a landing, once: the total changed', async () => {
    chainOf(1253)
    walkAt(6)
    const m = await mountChip()
    chainOf(1254)
    await settled()
    expect(explorerRenders()).toBe(1)
    expect(m.says('CHAIN 1254/1254')).toBe(true)
    await m.unmount()
  })

  it('leaves the button alone when the explorer renders for its own reasons: its comment count settling', async () => {
    chainOf(1253)
    walkAt(6)
    const m = await mount(<ChainExplorer />)
    resetCounts()
    // The mark rests on the head: 450 ms later the explorer renders again, to count its comments.
    await new Promise((r) => setTimeout(r, 520))
    await settled()
    expect(explorerRenders()).toBeGreaterThanOrEqual(1)
    expect(aheadRenders()).toBe(0)
    await m.unmount()
  })
})

describe('the LOSING SYNC warning renders only while it shows', () => {
  it('renders nothing under 15, once per count from 15, and sets no state while rendering', async () => {
    walkAt(0)
    const m = await mount(<SyncWarning />)
    resetCounts()
    for (let n = 1; n <= 14; n++) { walkAt(n); await settled() }
    expect(aheadRenders()).toBe(0)
    for (let n = 15; n <= 20; n++) { walkAt(n); await settled() }
    expect(aheadRenders()).toBe(6)
    // Pressed aside, then caught up: put back after the commit, not during a render.
    useSyncWarnAside.setState({ aside: true })
    await settled()
    resetCounts()
    walkAt(0)
    await settled()
    expect(useSyncWarnAside.getState().aside).toBe(false)
    // One render for the count, one for the aside put back: never two calls for one change.
    expect(aheadRenders()).toBe(2)
    await m.unmount()
  })
})

// ---- The stylesheet: transform and opacity only ----

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const chipSection = ((): string => {
  const raw = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8')
  return raw.slice(raw.indexOf('/* ---------- Chain chip: how far ahead ----------'), raw.indexOf('/* What is left when the pad is dismissed')).replace(/\/\*[\s\S]*?\*\//g, '')
})()
const warnSection = css.slice(css.indexOf('.syncwarn {'), css.indexOf('.syncwarn__off:focus-visible'))
const COMPOSITED = new Set(['transform', 'opacity'])

/** Every keyframes block in the stylesheet, by name: the properties it sets. */
function keyframes(name: string): string[] {
  const at = css.indexOf(`@keyframes ${name} {`)
  expect([name, at >= 0]).toEqual([name, true])
  let depth = 0
  let i = css.indexOf('{', at)
  const from = i
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) break
  }
  const body = css.slice(from + 1, i)
  return [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1])
}

/** The animation names and the transitioned properties in a stretch of the stylesheet. */
function motion(section: string): { animations: string[]; eased: string[] } {
  const animations = new Set<string>()
  const eased = new Set<string>()
  for (const m of section.matchAll(/(?:^|[;{\s])animation\s*:\s*([^;}]+)/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+/).find((w) => /^[a-z][\w-]*$/i.test(w) && !/^(ease|ease-in|ease-out|ease-in-out|linear|infinite|none|both|forwards|backwards|alternate|normal|reverse|running|paused)$/.test(w) && !/^cubic-bezier|^steps/.test(w))
      if (name) animations.add(name)
    }
  }
  for (const m of section.matchAll(/(?:^|[;{\s])transition\s*:\s*([^;}]+)/g)) {
    for (const part of m[1].split(/,(?![^(]*\))/)) {
      const prop = part.trim().split(/\s+/)[0]
      if (prop && prop !== 'none') eased.add(prop)
    }
  }
  return { animations: [...animations], eased: [...eased] }
}

describe('the motion of the chip, its bar and the warning', () => {
  for (const [name, section] of [['the chip and its bar', chipSection], ['the LOSING SYNC warning', warnSection]] as const) {
    it(`${name}: every animation sets only transform and opacity`, () => {
      const { animations } = motion(section)
      expect(animations.length).toBeGreaterThan(0)
      for (const a of animations) {
        const props = keyframes(a)
        expect([a, props.filter((p) => !COMPOSITED.has(p))]).toEqual([a, []])
      }
    })

    it(`${name}: every transition is of transform or opacity`, () => {
      const { eased } = motion(section)
      expect(eased.filter((p) => !COMPOSITED.has(p))).toEqual([])
    })
  }

  it('the chip and its bar: no animated inset, box-shadow, background, border, colour or filter anywhere in the section', () => {
    const { animations, eased } = motion(chipSection)
    expect(animations.sort()).toEqual(['ahead-breathe', 'ahead-brk', 'ahead-glint', 'ahead-going', 'ahead-going-flash', 'ahead-ign', 'ahead-ign-flash', 'ahead-in'].sort())
    expect(eased).toEqual(['opacity'])
  })

  it('the warning: the stripes crawl by transform, not background-position', () => {
    const { animations } = motion(warnSection)
    expect(animations).toEqual(['syncwarn-crawl'])
    expect(keyframes('syncwarn-crawl')).toEqual(['transform'])
    // The stripes layer is what moves, and the box itself animates nothing.
    expect(warnSection).toMatch(/\.syncwarn\.is-on \.syncwarn__stripes::before \{\s*animation: syncwarn-crawl 4s linear infinite;/)
    expect(warnSection.slice(warnSection.indexOf('.syncwarn.is-on {'), warnSection.indexOf('}', warnSection.indexOf('.syncwarn.is-on {')))).not.toMatch(/animation/)
  })
})
