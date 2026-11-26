/**
 * chipFold.test.tsx: the arrow chip under the top-left stack (hud/ChipFold.tsx,
 * store/chipsFold.ts; owner, 2026-11-26) and NEARBY's orange +N
 * (hud/NearbyChip.tsx, store/nearbyNew.ts; the same day). The arrow puts the
 * chips away, unmounted once they have slid off, and brings them back; its
 * point turns; the choice is kept per identity and read again after a
 * reload; a chip whose state lives in its store draws the same after coming
 * back. The +N counts the finds marked since the Nearby list was last
 * opened, among what NEARBY lists, clears when the list opens, and is kept
 * per identity. No network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
})
const loot = vi.hoisted(() => ({ keys: [] as string[] }))
vi.mock('../../hooks/useNearbyLoot', () => ({ useNearbyLoot: () => loot.keys.map((key) => ({ key, distance: 0n })) }))

import { useEffect, type ReactNode } from 'react'
import { mount, settled, textOf, type Host, type Mounted } from '../../test/elementRoot'
import { ChipFold, foldMoveMs, useChipFoldPhase, type FoldPhase } from '../ChipFold'
import { NearbyChip } from '../NearbyChip'
import { ToastChip } from '../ToastChip'
import { CHIPS_FOLD_PREFIX, chipsFoldedFor, forgetChipsFold, setChipsFolded, useChipsFolded } from '../../store/chipsFold'
import { NEARBY_NEW_PREFIX, addNearbyNew, clearNearbyNew, forgetNearbyNew, freshAmong, nearbyNewFor } from '../../store/nearbyNew'
import { movesToKv } from '../../lib/kvStore'
import { useCyberspace } from '../../store/useCyberspace'
import { useShards } from '../../store/useShards'
import { useToast } from '../../store/useToast'

;(globalThis as { window?: unknown }).window ??= globalThis

const me = (): string => useCyberspace.getState().identity.pubkey
const OTHER = 'b'.repeat(64)
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** A chip that counts its mounts and unmounts, and whether its own timer is still running. */
const life = { mounts: 0, unmounts: 0, ticking: false }
function Probe(): JSX.Element {
  useEffect(() => {
    life.mounts++
    life.ticking = true
    const t = setInterval(() => undefined, 1000)
    return () => { clearInterval(t); life.ticking = false; life.unmounts++ }
  }, [])
  return <div className="probe">PROBE</div>
}

/** The stack as App draws it: the chips while not `hidden`, then the arrow. */
let lastPhase: FoldPhase = 'shown'
function Stack({ children }: { children: ReactNode }): JSX.Element {
  const folded = useChipsFolded()
  const phase = useChipFoldPhase(folded, false)
  lastPhase = phase
  return (
    <div className={`instruments instruments--${phase}`}>
      {phase !== 'hidden' && <div className="instruments__group">{children}</div>}
      <ChipFold phase={phase} folded={folded} />
    </div>
  )
}

const arrowOf = (m: Mounted): Host => {
  const a = m.all().find((h) => typeof h.props.className === 'string' && (h.props.className as string).startsWith('chipfold'))
  if (!a) throw new Error('no arrow chip')
  return a
}
async function tap(m: Mounted): Promise<void> {
  ;(arrowOf(m).props.onClick as () => void)()
  await settled()
}
/** Past the slide, and React's work after it. */
async function afterMove(): Promise<void> {
  await wait(foldMoveMs(false) + 60)
  await settled()
}

beforeEach(() => {
  localStorage.clear()
  forgetChipsFold()
  forgetNearbyNew()
  life.mounts = 0; life.unmounts = 0; life.ticking = false
  useShards.setState({ nearbyOpen: false })
  useToast.setState({ toast: null })
  loot.keys = []
})
afterEach(() => { setChipsFolded(false) })

describe('the arrow chip puts the chips away and brings them back', () => {
  it('slides them off, then unmounts them (their timers stop), and mounts them again on the second tap', async () => {
    const m = await mount(<Stack><Probe /></Stack>)
    expect(life.mounts).toBe(1)
    expect(m.says('PROBE')).toBe(true)
    await tap(m)
    // Still on the page while they slide away.
    expect(lastPhase).toBe('leaving')
    expect(m.says('PROBE')).toBe(true)
    await afterMove()
    expect(lastPhase).toBe('hidden')
    expect(m.says('PROBE')).toBe(false)
    expect(life.unmounts).toBe(1)
    expect(life.ticking).toBe(false)
    await tap(m)
    expect(m.says('PROBE')).toBe(true)
    expect(life.mounts).toBe(2)
    await afterMove()
    expect(lastPhase).toBe('shown')
    await m.unmount()
  })

  it('turns its point: left with the chips out, right with them away, and says which in its label', async () => {
    const m = await mount(<Stack><Probe /></Stack>)
    expect(arrowOf(m).props['aria-label']).toBe('Hide status chips')
    expect(arrowOf(m).props['aria-expanded']).toBe(true)
    expect(arrowOf(m).props.className).toBe('chipfold')
    await tap(m)
    expect(arrowOf(m).props['aria-label']).toBe('Show status chips')
    expect(arrowOf(m).props['aria-expanded']).toBe(false)
    expect(arrowOf(m).props.className).toBe('chipfold chipfold--out')
    await afterMove()
    await tap(m)
    expect(arrowOf(m).props.className).toBe('chipfold')
    await m.unmount()
  })

  it('a tap mid-slide turns them round where they are, never unmounting them', async () => {
    const m = await mount(<Stack><Probe /></Stack>)
    await tap(m)
    expect(lastPhase).toBe('leaving')
    await tap(m)
    expect(lastPhase).toBe('entering')
    await afterMove()
    expect(lastPhase).toBe('shown')
    expect(life.unmounts).toBe(0)
    await m.unmount()
  })

  it('a chip draws what its store holds after coming back: a toast put away is still there', async () => {
    useToast.getState().show({ label: 'STARRED', meta: 'a place', mark: 'star', sticky: true })
    const m = await mount(<Stack><ToastChip /></Stack>)
    expect(m.says('STARRED')).toBe(true)
    await tap(m)
    await afterMove()
    expect(m.says('STARRED')).toBe(false)
    await tap(m)
    expect(m.says('STARRED')).toBe(true)
    await m.unmount()
  })
})

describe('kept per identity in IndexedDB (store/chipsFold.ts)', () => {
  it('is a kvStore record per pubkey, and the other identity keeps its own', () => {
    expect(movesToKv(CHIPS_FOLD_PREFIX + me())).toBe(true)
    setChipsFolded(true)
    expect(chipsFoldedFor(me())).toBe(true)
    expect(chipsFoldedFor(OTHER)).toBe(false)
    setChipsFolded(true, OTHER)
    setChipsFolded(false)
    expect(chipsFoldedFor(OTHER)).toBe(true)
    expect(chipsFoldedFor(me())).toBe(false)
  })

  it('survives a reload: a page that starts folded starts with the chips away, and no slide', async () => {
    setChipsFolded(true)
    forgetChipsFold()
    expect(chipsFoldedFor(me())).toBe(true)
    const m = await mount(<Stack><Probe /></Stack>)
    expect(lastPhase).toBe('hidden')
    expect(life.mounts).toBe(0)
    expect(arrowOf(m).props['aria-label']).toBe('Show status chips')
    await m.unmount()
  })
})

describe('NEARBY 168 +12 (hud/NearbyChip.tsx, store/nearbyNew.ts)', () => {
  const label = (m: Mounted): string => textOf(m.all().find((h) => h.props.className === 'hyperbar__label')!)
  const fresh = (m: Mounted): Host | undefined => m.all().find((h) => h.props.className === 'nearby__new')

  it('says how many are new, in its own orange span, among what NEARBY lists', async () => {
    loot.keys = ['a', 'b', 'c', 'd']
    addNearbyNew(['c', 'd', 'far-away'])
    const m = await mount(<NearbyChip />)
    expect(label(m)).toBe('NEARBY 4+2')
    expect(fresh(m)).toBeDefined()
    // More found: the count goes up.
    addNearbyNew(['b'])
    await settled()
    expect(label(m)).toBe('NEARBY 4+3')
    await m.unmount()
  })

  it('shows no +N with nothing new', async () => {
    loot.keys = ['a']
    const m = await mount(<NearbyChip />)
    expect(label(m)).toBe('NEARBY 1')
    expect(fresh(m)).toBeUndefined()
    await m.unmount()
  })

  it('clears when the Nearby list is opened, from anywhere, and a find made with it open is not new', async () => {
    loot.keys = ['a', 'b']
    addNearbyNew(['a', 'b'])
    expect(nearbyNewFor(me()).size).toBe(2)
    useShards.getState().setNearbyOpen(true)
    expect(nearbyNewFor(me()).size).toBe(0)
    addNearbyNew(['c'])
    expect(nearbyNewFor(me()).size).toBe(0)
    useShards.getState().setNearbyOpen(false)
    const m = await mount(<NearbyChip />)
    expect(label(m)).toBe('NEARBY 2')
    await m.unmount()
  })

  it('is kept per identity and through a reload', () => {
    expect(movesToKv(NEARBY_NEW_PREFIX + me())).toBe(true)
    addNearbyNew(['x', 'y'])
    addNearbyNew(['z'], OTHER)
    forgetNearbyNew()
    expect([...nearbyNewFor(me())].sort()).toEqual(['x', 'y'])
    expect([...nearbyNewFor(OTHER)]).toEqual(['z'])
    clearNearbyNew()
    expect(nearbyNewFor(me()).size).toBe(0)
    expect(nearbyNewFor(OTHER).size).toBe(1)
  })

  it('counts each find once, and only those listed', () => {
    addNearbyNew(['a', 'a', 'b'])
    addNearbyNew(['b'])
    expect(nearbyNewFor(me()).size).toBe(2)
    expect(freshAmong(['b', 'q'], nearbyNewFor(me()))).toBe(1)
    expect(freshAmong([], nearbyNewFor(me()))).toBe(0)
  })
})
