/**
 * hudFlags.test.tsx: ?nochip=1 and ?nosyncwarn=1 (lib/hudFlags.ts), the
 * switches for testing whether the CHAIN chip's edge bar or the LOSING SYNC
 * warning makes WALK stutter on a phone (arkinox, 2026-11-21). Each takes its
 * piece off the page entirely: the component is not mounted and the hooks
 * that feed it (useChainAhead, useEventsAhead, the chip's store reads) do not
 * run. Without them nothing changes. The flags stay on through reloads of the
 * tab until `=0`, as ?diag=1 does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type Host } from '../../test/elementRoot'

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
vi.mock('../../hooks/useSocial', () => ({ useActionComments: () => ({ comments: [], loading: false, refresh: () => {} }) }))
// The hooks that feed the chip and the warning, watched.
vi.mock('../../store/walkAhead', async (orig) => {
  const real = await orig() as typeof import('../../store/walkAhead')
  return { ...real, useEventsAhead: vi.fn(real.useEventsAhead) }
})
vi.mock('../ChainAhead', async (orig) => {
  const real = await orig() as typeof import('../ChainAhead')
  return { ...real, useChainAhead: vi.fn(real.useChainAhead) }
})
vi.mock('../../store/useBuilder', async (orig) => {
  const real = await orig() as typeof import('../../store/useBuilder')
  return { ...real, useBuilder: vi.fn(real.useBuilder) }
})

import { ChainExplorer } from '../ChainExplorer'
import { SyncWarning } from '../SyncWarning'
import { useChainAhead } from '../ChainAhead'
import { hudFlagKey, hudFlagsFrom, setHudFlagsForTest, type HudFlags } from '../../lib/hudFlags'
import { useBuilder } from '../../store/useBuilder'
import { useCyberspace } from '../../store/useCyberspace'
import { useWalk } from '../../store/useWalk'
import { useEventsAhead } from '../../store/walkAhead'

;(globalThis as { window?: unknown }).window ??= globalThis
;(globalThis as { document?: unknown }).document ??= { visibilityState: 'visible', addEventListener: () => undefined, removeEventListener: () => undefined }

const spawn = { id: 'e'.repeat(64), pubkey: 'p'.repeat(64), type: 'spawn', position: { x: 1n, y: 2n, z: 3n }, plane: 0, created_at: 1 }
const realChain = useCyberspace.getState().focusChain
const chain = Array.from({ length: 3 }, (_, i) => ({ ...spawn, id: i.toString(16).padStart(64, '0') }))

/** Walking, 17 events ahead: the chip's edge bar is drawn and the warning half shown. */
function aheadInWalk(): void {
  useCyberspace.setState({ walking: true, focusChain: () => chain as unknown as ReturnType<typeof realChain>, events: [] })
  useWalk.setState({ behind: 17, open: null, queue: [], running: null })
}

const OFF: HudFlags = { nochip: false, nosyncwarn: false }

afterEach(() => {
  setHudFlagsForTest(null)
  vi.mocked(useEventsAhead).mockClear()
  vi.mocked(useChainAhead).mockClear()
  vi.mocked(useBuilder).mockClear()
  useWalk.setState({ behind: 0, open: null, queue: [], running: null })
  useCyberspace.setState({ walking: false, focusChain: realChain, events: [], spectate: null, exploreIndex: null, forkNotice: null })
})

/** The classes and the words on the page, as one string. */
const flat = (h: Host | string): string => typeof h === 'string' ? h : h.type === '#text' ? String(h.props.text) : `${String(h.props.className ?? '')} ${h.children.map(flat).join(' ')}`
const classes = (m: { all: () => Host[] }): string => m.all().map(flat).join(' ')

describe('?nochip=1', () => {
  it('does not mount the CHAIN chip, and none of its hooks run', async () => {
    setHudFlagsForTest({ ...OFF, nochip: true })
    aheadInWalk()
    const m = await mount(<ChainExplorer />)
    expect(m.all()).toEqual([])
    expect(useChainAhead).not.toHaveBeenCalled()
    expect(useEventsAhead).not.toHaveBeenCalled()
    expect(useBuilder).not.toHaveBeenCalled()
    await m.unmount()
  })

  it('leaves the LOSING SYNC warning on', async () => {
    setHudFlagsForTest({ ...OFF, nochip: true })
    aheadInWalk()
    const m = await mount(<SyncWarning />)
    expect(classes(m)).toContain('WARNING: LOSING SYNC')
    await m.unmount()
  })
})

describe('?nosyncwarn=1', () => {
  it('does not mount the LOSING SYNC warning, and its hooks do not run', async () => {
    setHudFlagsForTest({ ...OFF, nosyncwarn: true })
    aheadInWalk()
    const m = await mount(<SyncWarning />)
    expect(m.all()).toEqual([])
    expect(useEventsAhead).not.toHaveBeenCalled()
    await m.unmount()
  })

  it('leaves the CHAIN chip and its edge bar on', async () => {
    setHudFlagsForTest({ ...OFF, nosyncwarn: true })
    aheadInWalk()
    const m = await mount(<ChainExplorer />)
    expect(classes(m)).toContain('aheadbar')
    await m.unmount()
  })
})

describe('without either', () => {
  it('mounts the chip with its edge bar and the warning, fed as before', async () => {
    setHudFlagsForTest(OFF)
    aheadInWalk()
    const chip = await mount(<ChainExplorer />)
    expect(classes(chip)).toContain('CHAIN ')
    expect(classes(chip)).toContain('aheadbar')
    expect(useChainAhead).toHaveBeenCalled()
    expect(useBuilder).toHaveBeenCalled()
    expect(useEventsAhead).toHaveBeenCalled()
    await chip.unmount()
    vi.mocked(useEventsAhead).mockClear()
    const warn = await mount(<SyncWarning />)
    expect(classes(warn)).toContain('WARNING: LOSING SYNC')
    expect(classes(warn)).toContain('is-on')
    expect(useEventsAhead).toHaveBeenCalled()
    await warn.unmount()
  })
})

describe('reading the flags', () => {
  const tab = (): Map<string, string> & { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } => {
    const mem = new Map<string, string>() as ReturnType<typeof tab>
    mem.getItem = (k) => mem.get(k) ?? null
    mem.setItem = (k, v) => { mem.set(k, v) }
    mem.removeItem = (k) => { mem.delete(k) }
    return mem
  }

  it('is off with nothing asked', () => {
    expect(hudFlagsFrom('', tab())).toEqual(OFF)
    expect(hudFlagsFrom('?diag=1', tab())).toEqual(OFF)
  })

  it('takes each on its own, and both with ?diag=1', () => {
    expect(hudFlagsFrom('?nochip=1', tab())).toEqual({ nochip: true, nosyncwarn: false })
    expect(hudFlagsFrom('?nosyncwarn=1', tab())).toEqual({ nochip: false, nosyncwarn: true })
    expect(hudFlagsFrom('?diag=1&nochip=1&nosyncwarn=1', tab())).toEqual({ nochip: true, nosyncwarn: true })
  })

  it('stays on through a reload of the tab until =0', () => {
    const store = tab()
    hudFlagsFrom('?diag=1&nochip=1', store)
    expect(store.get(hudFlagKey('nochip'))).toBe('1')
    expect(hudFlagsFrom('', store)).toEqual({ nochip: true, nosyncwarn: false })
    expect(hudFlagsFrom('?nochip=0', store)).toEqual(OFF)
    expect(store.has(hudFlagKey('nochip'))).toBe(false)
    expect(hudFlagsFrom('', store)).toEqual(OFF)
  })

  it('still takes the query for this load when the tab refuses storage', () => {
    const refusing = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') }, removeItem: () => { throw new Error('no') } }
    expect(hudFlagsFrom('?nochip=1', refusing)).toEqual({ nochip: true, nosyncwarn: false })
    expect(hudFlagsFrom('', refusing)).toEqual(OFF)
    expect(hudFlagsFrom('', null)).toEqual(OFF)
  })
})
