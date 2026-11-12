/**
 * itemsPanelCompact.test.tsx: the ITEMS panel's two headings and its key
 * item buttons (arkinox, 2026-11-09: "the buttons on the Items are way too
 * large. Make them like the buttons below on the 'taken' things", and the
 * headings KEY ITEMS — MAY UNLOCK DOORS OR CHESTS and OTHER LOOT), the
 * header chip named after them, and the OTHER LOOT rows wrapping as the key
 * item rows do, so nothing runs off the panel at 320px. Each row shows one
 * ACTIONS button that opens its actions under it, one row at a time, and a
 * listed item says LISTED on its line (arkinox, 2026-11-12). Mounted,
 * each store brought up to date first; the size is read from styles.css.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}
vi.mock('../../scene/CardSpin', () => ({ CardSpin: () => null }))
vi.mock('../../lib/relay', () => ({
  onAuthChange: () => () => {},
  onCanonicalSignIn: () => () => {},
  signInFailed: () => false,
  queryChecked: vi.fn(async () => ({ events: [], trouble: null })),
  queryEach: vi.fn(async () => []),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../../lib/events'
import { forgeKey } from '../../lib/chests'
import { keyInnerTemplate, messageInnerTemplate } from '../../lib/hidden'
import { heldFromForged, type HeldItem } from '../../lib/inventory'
import { mount, textOf, type Host } from '../../test/elementRoot'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useItemFeed } from '../../store/useItemFeed'
import { escapeTop, topEscape } from '../../hooks/useEscape'
import { useShards } from '../../store/useShards'
import { heldCount, InventoryPanel, KEY_ITEMS_HEADING, OTHER_LOOT_HEADING } from '../InventoryPanel'

const at = { x: 1n, y: 2n, z: 3n }
const place = { lookupId: 'l', bagId: 'b', at: { x: '1', y: '2', z: '3' }, plane: 0 as const, height: 4 }

/** You, a key you forged and hold, and a note taken out of a chest. */
function seed(): () => void {
  const was = useCyberspace.getState().identity
  const sk = generateSecretKey()
  const me = getPublicKey(sk)
  useCyberspace.setState({ identity: { ...was, pubkey: me }, live: false })
  const lock = forgeKey('Silver Key')
  const keyEv = finalizeEvent(keyInnerTemplate(lock, at, 0, 2), sk) as NostrEvent
  const key = heldFromForged(me, keyEv, lock, place, 2)
  const other = generateSecretKey()
  const noteEv = finalizeEvent(messageInnerTemplate('meet me at the obelisk', at, 0, 3), other) as NostrEvent
  const note: HeldItem = { rowKey: `${me}/${noteEv.id}`, owner: me, id: noteEv.id, type: 'message', name: 'A note', event: noteEv, author: noteEv.pubkey, verified: true, source: 'taken', place, from: { chestId: 'c'.repeat(64), chestName: 'Wind Chest' }, at: 3, text: 'meet me at the obelisk' }
  useShards.setState({ mine: [], discovered: {}, deleted: {} })
  useInventory.setState({ owner: me, items: { [key.id]: key, [note.id]: note }, storage: 'memory' })
  return () => useCyberspace.setState({ identity: was })
}

const cls = (h: Host): string => String(h.props.className ?? '')
const rowsOf = (hosts: Host[], item: boolean): Host[] => hosts.filter((h) => h.type === 'li' && cls(h).split(' ').includes('held__row') && cls(h).includes('held__row--item') === item)
function buttonsIn(h: Host): Host[] {
  const out: Host[] = []
  const walk = (n: Host | string): void => {
    if (typeof n === 'string') return
    if (n.type === 'button') out.push(n)
    n.children.forEach(walk)
  }
  walk(h)
  return out
}

beforeEach(() => {
  useInventory.setState({ items: {} })
})

describe('ITEMS headings', () => {
  it('reads KEY ITEMS — MAY UNLOCK DOORS OR CHESTS over the items you hold and OTHER LOOT over what was taken, never the old headings', async () => {
    expect(KEY_ITEMS_HEADING).toBe('KEY ITEMS — MAY UNLOCK DOORS OR CHESTS')
    expect(OTHER_LOOT_HEADING).toBe('OTHER LOOT')
    const restore = seed()
    const m = await mount(createElement(InventoryPanel))
    const labels = m.all().filter((h) => cls(h) === 'legend__label').map(textOf)
    expect(labels).toEqual([KEY_ITEMS_HEADING, OTHER_LOOT_HEADING])
    expect(m.says('Items you hold')).toBe(false)
    expect(labels.some((l) => /^taken$/i.test(l))).toBe(false)
    // The X and CLEAR ALL name the heading they clear from.
    const x = m.all().find((h) => cls(h) === 'held__clear')
    expect(x?.props.title).toBe('Clear it from OTHER LOOT')
    expect(x?.props['aria-label']).toBe('Clear A note from OTHER LOOT')
    expect(String(m.buttons(/^CLEAR ALL$/)[0]?.props.title)).toMatch(/^Clear everything from OTHER LOOT /)
    await m.unmount()
    restore()
  })
})

describe('the header chip', () => {
  it('counts KEY ITEMS and LOOT, singular for one key item, LOOT for any count, NOTHING HELD when empty', async () => {
    expect(heldCount(3, 4)).toBe('3 KEY ITEMS · 4 LOOT')
    expect(heldCount(1, 1)).toBe('1 KEY ITEM · 1 LOOT')
    expect(heldCount(2, 0)).toBe('2 KEY ITEMS')
    expect(heldCount(0, 5)).toBe('0 KEY ITEMS · 5 LOOT')
    expect(heldCount(0, 0)).toBe('NOTHING HELD')
    const restore = seed()
    const m = await mount(createElement(InventoryPanel))
    expect(m.says('1 KEY ITEM · 1 LOOT')).toBe(true)
    expect(m.all().some((h) => /TAKEN/.test(textOf(h)) && cls(h) === 'tag')).toBe(false)
    await m.unmount()
    restore()
  })
})

describe('key item buttons', () => {
  it('are one ACTIONS button a row, opening DETAILS, COPY, PLACE, PUBLISH, ARCHIVE and DELETE in a labelled line under it, all chest__act, DELETE keeping its danger class', async () => {
    const restore = seed()
    const m = await mount(createElement(InventoryPanel))
    const [held] = rowsOf(m.all(), true)
    const [taken] = rowsOf(m.all(), false)
    expect(held).toBeDefined()
    expect(taken).toBeDefined()
    // Closed: ACTIONS alone on each row, the taken row's X beside it.
    expect(buttonsIn(held).map(textOf)).toEqual(['ACTIONS'])
    expect(buttonsIn(taken).filter((b) => cls(b) !== 'held__clear').map(textOf)).toEqual(['ACTIONS'])
    expect(buttonsIn(held)[0].props['aria-expanded']).toBe(false)
    await m.press(/^ACTIONS$/)
    const [open] = rowsOf(m.all(), true)
    const heldButtons = buttonsIn(open)
    expect(heldButtons.map(textOf)).toEqual(['ACTIONS', 'DETAILS', 'COPY', 'PLACE', 'PUBLISH', 'ARCHIVE', 'DELETE'])
    expect(heldButtons[0].props['aria-expanded']).toBe(true)
    const group = m.all().find((h) => cls(h) === 'held__menu')!
    expect(group.props.role).toBe('group')
    expect(group.props['aria-label']).toBe('Actions for Silver Key')
    expect(heldButtons[0].props['aria-controls']).toBe(group.props.id)
    for (const b of heldButtons) expect(cls(b).split(' ')).toContain('chest__act')
    expect(cls(heldButtons.find((b) => textOf(b) === 'DELETE')!)).toBe('chest__act chest__act--danger')
    expect(heldButtons.find((b) => textOf(b) === 'PUBLISH')!.props.disabled).toBe(false)
    // ACTIONS again hides them.
    await m.press(/^ACTIONS$/)
    expect(buttonsIn(rowsOf(m.all(), true)[0]).map(textOf)).toEqual(['ACTIONS'])
    await m.unmount()
    restore()
  })

  it('open one row at a time: the taken row’s ACTIONS closes the key item’s, and shows READ, DETAILS and ARCHIVE in chest__act', async () => {
    const restore = seed()
    const m = await mount(createElement(InventoryPanel))
    await m.press(/^ACTIONS$/)
    expect(m.all().filter((h) => cls(h) === 'held__menu')).toHaveLength(1)
    const takenActions = buttonsIn(rowsOf(m.all(), false)[0]).find((b) => textOf(b) === 'ACTIONS')!
    ;(takenActions.props.onClick as () => void)()
    await new Promise((r) => setTimeout(r, 20))
    expect(m.all().filter((h) => cls(h) === 'held__menu')).toHaveLength(1)
    expect(buttonsIn(rowsOf(m.all(), true)[0]).map(textOf)).toEqual(['ACTIONS'])
    const taken = buttonsIn(rowsOf(m.all(), false)[0]).filter((b) => cls(b) !== 'held__clear')
    expect(taken.map(textOf)).toEqual(['ACTIONS', 'READ', 'DETAILS', 'ARCHIVE'])
    for (const b of taken) expect(cls(b).split(' ')).toContain('chest__act')
    await m.unmount()
    restore()
  })

  it('close with Escape, on the menu layer, leaving nothing on the Escape stack', async () => {
    const restore = seed()
    const m = await mount(createElement(InventoryPanel))
    expect(topEscape()).toBeNull()
    await m.press(/^ACTIONS$/)
    expect(topEscape()?.layer).toBe('menu')
    expect(m.all().filter((h) => cls(h) === 'held__menu')).toHaveLength(1)
    expect(escapeTop()).toBe(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(m.all().filter((h) => cls(h) === 'held__menu')).toHaveLength(0)
    expect(topEscape()).toBeNull()
    await m.unmount()
    restore()
  })

  it('say LISTED on the line of an item already in the ITEM FEED, never as a button, and offer no PUBLISH', async () => {
    const restore = seed()
    const was = useItemFeed.getState().listedBy
    useItemFeed.setState({ listedBy: () => true })
    try {
      const m = await mount(createElement(InventoryPanel))
      const meta = m.all().find((h) => cls(h) === 'item__meta' && /forged by you/.test(textOf(h)))!
      expect(textOf(meta)).toMatch(/· LISTED/)
      await m.press(/^ACTIONS$/)
      const held = buttonsIn(rowsOf(m.all(), true)[0]).map(textOf)
      expect(held).toEqual(['ACTIONS', 'DETAILS', 'COPY', 'PLACE', 'ARCHIVE', 'DELETE'])
      expect(m.buttons(/LISTED|PUBLISH/)).toHaveLength(0)
      await m.unmount()
    } finally {
      useItemFeed.setState({ listedBy: was })
      restore()
    }
  })

  it('share one wrapping row with the OTHER LOOT rows: the taken row carries held__row--loot, and both classes get the same flex-wrap layout, buttons pushed right and allowed to wrap', async () => {
    const restore = seed()
    const m = await mount(createElement(InventoryPanel))
    const [taken] = rowsOf(m.all(), false)
    expect(cls(taken).split(' ')).toContain('held__row--loot')
    await m.unmount()
    restore()
    // Comments out, so a rule's selector is only its selector.
    const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const ruleFor = (part: string): string[] => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel]) => sel.split(',').some((x) => x.trim() === part)).map(([, , body]) => body)
    for (const row of ['.held__row--item', '.held__row--loot']) {
      expect(ruleFor(row).join(';')).toMatch(/display: flex;.*flex-wrap: wrap/)
      expect(ruleFor(`${row} > .held__acts`).join(';')).toMatch(/margin-left: auto;.*flex-wrap: wrap/)
    }
  })

  it('carry no size of their own in styles.css: no fingertip minimum on a key item row or its DELETE, nothing resizing .chest__act under .held__row--item', () => {
    const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8')
    // Every rule whose selector names a key item row or held__acts' DELETE.
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel]) => /held__row--item|held__acts\s+\.chest__act--danger/.test(sel))
    expect(rules.length).toBeGreaterThan(0)
    for (const [, sel, body] of rules) {
      expect(sel).not.toMatch(/\.chest__act/)
      expect(body).not.toMatch(/min-height|min-width|padding|font-size/)
    }
  })
})
