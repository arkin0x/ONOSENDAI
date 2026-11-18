/**
 * chainPanelRows.test.tsx: the Proof chain panel draws the newest rows of a
 * long chain, not every one (hud/ChainPanel.tsx CHAIN_ROWS_SHOWN).
 *
 * arkinox's ?diag=1 report of 2026-11-19 counted about 20,000 DOM nodes with
 * the menu open and about 250 with it shut: one row of about eighteen nodes
 * for each of his ~1,300 actions, redrawn on every publish result. The panel
 * now draws the newest CHAIN_ROWS_SHOWN with their true numbers, and one line
 * above them that opens the chain explorer for the older ones.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, textOf, type Host } from '../../test/elementRoot'

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

import { CHAIN_ROWS_SHOWN, ChainPanel, firstShownRow } from '../ChainPanel'
import { useCyberspace } from '../../store/useCyberspace'
import { useBuilder } from '../../store/useBuilder'

;(globalThis as { window?: unknown }).window ??= globalThis
// The relay status under the panel listens for the page going on and off line.
;(globalThis as { addEventListener?: unknown }).addEventListener ??= () => undefined
;(globalThis as { removeEventListener?: unknown }).removeEventListener ??= () => undefined
;(globalThis as { document?: unknown }).document ??= { visibilityState: 'visible', addEventListener: () => undefined, removeEventListener: () => undefined }

const real = useCyberspace.getState()
afterEach(() => useCyberspace.setState(real, true))

/** A chain of `n` events as the panel reads them: ids only, every one published. */
function chainOf(n: number): void {
  const events = Array.from({ length: n }, (_, i) => ({ id: i.toString(16).padStart(64, '0'), pubkey: 'a'.repeat(64), kind: 3333, created_at: 1, tags: [], content: '', sig: '' }))
  useCyberspace.setState({ events: events as never, published: Object.fromEntries(events.map((e) => [e.id, 'ok'])) as never, actions: () => [] })
}

const rows = (all: Host[]): Host[] => all.filter((h) => h.type === 'li' && String(h.props.className).includes('chainrows__row'))
const numberOf = (row: Host): string => textOf(row.children[0] as Host)

describe('which rows the panel draws', () => {
  it('is every row of a short chain, and the newest CHAIN_ROWS_SHOWN of a long one', () => {
    expect(CHAIN_ROWS_SHOWN).toBe(100)
    expect(firstShownRow(0)).toBe(0)
    expect(firstShownRow(40)).toBe(0)
    expect(firstShownRow(100)).toBe(0)
    expect(firstShownRow(101)).toBe(1)
    expect(firstShownRow(10_812)).toBe(10_712)
  })
})

describe('the Proof chain panel', () => {
  it('draws a short chain whole, with no older line', async () => {
    chainOf(12)
    const m = await mount(<ChainPanel />)
    expect(rows(m.all()).length).toBe(12)
    expect(numberOf(rows(m.all())[0])).toBe('0')
    expect(m.buttons('OLDER').length).toBe(0)
    await m.unmount()
  })

  it('draws only the newest rows of a long chain, numbered as in the chain, under one line for the rest', async () => {
    chainOf(1_312)
    const m = await mount(<ChainPanel />)
    const drawn = rows(m.all())
    expect(drawn.length).toBe(CHAIN_ROWS_SHOWN)
    expect(numberOf(drawn[0])).toBe('1212')
    expect(numberOf(drawn[drawn.length - 1])).toBe('1311')
    // The ACTIONS count still says the whole chain.
    expect(m.buttons('1312 ACTIONS').length).toBe(1)
    expect(m.buttons(/OLDER ACTIONS/).map(textOf)).toEqual(['1,212 OLDER ACTIONS'])
    // About eighteen nodes a row before: now a hundred rows, whatever the chain's length.
    const before = m.all().length
    chainOf(5_000)
    await new Promise((r) => setTimeout(r, 20))
    expect(rows(m.all()).length).toBe(CHAIN_ROWS_SHOWN)
    expect(Math.abs(m.all().length - before)).toBeLessThan(5)
    await m.unmount()
  })

  it('opens the chain explorer at the newest of the older rows', async () => {
    chainOf(250)
    const explore = vi.fn()
    useCyberspace.setState({ explore })
    const m = await mount(<ChainPanel />)
    await m.press('150 OLDER ACTIONS')
    expect(explore).toHaveBeenCalledWith(149)
    await m.unmount()
  })

  it('does not open it while building', async () => {
    chainOf(250)
    useBuilder.setState({ active: true })
    const m = await mount(<ChainPanel />)
    expect(m.buttons('150 OLDER ACTIONS')[0].props.disabled).toBe(true)
    useBuilder.setState({ active: false })
    await m.unmount()
  })
})
