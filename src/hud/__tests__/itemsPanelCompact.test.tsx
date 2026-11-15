/**
 * itemsPanelCompact.test.tsx: the ITEMS panel as two buttons, KEY ITEMS and
 * OTHER LOOT, each opening a stacked modal of that kind alone, KEY ITEMS
 * with MINE and FEED (owner, 2026-11-14). Then, inside them, the key item
 * buttons (arkinox, 2026-11-09: "the buttons on the Items are way too
 * large. Make them like the buttons below on the 'taken' things"), and the
 * OTHER LOOT rows wrapping as the key item rows do, so nothing runs off the
 * panel at 320px. Each row shows one
 * ACTIONS button that opens its actions under it, one row at a time, and a
 * listed item says LISTED on its line (arkinox, 2026-11-12). No emoji, no
 * X and no CLEAR ALL (owner, 2026-11-14; itemsDelete.test). Mounted,
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
import { stackedOpen } from '../modalStack'
import type { ItemListing } from '../../lib/itemListing'
import { useMutes } from '../../store/useMutes'
import { FEED_LINE, FEED_PAGE, InventoryPanel, KEY_ITEMS_LABEL, KEY_ITEMS_NOTE, NO_KEY_ITEMS, NO_OTHER_LOOT, OTHER_LOOT_LABEL, kindLabel, tapKeepsActions, useItemsModal } from '../InventoryPanel'

const at = { x: 1n, y: 2n, z: 3n }
const place = { lookupId: 'l', bagId: 'b', at: { x: '1', y: '2', z: '3' }, plane: 0 as const, height: 4 }

/** You, two keys you forged and hold, and a note taken out of a chest. */
function seed(): { me: string; silver: HeldItem; restore: () => void } {
  const was = useCyberspace.getState().identity
  const sk = generateSecretKey()
  const me = getPublicKey(sk)
  useCyberspace.setState({ identity: { ...was, pubkey: me }, live: false })
  const lock = forgeKey('Silver Key')
  const keyEv = finalizeEvent(keyInnerTemplate(lock, at, 0, 2), sk) as NostrEvent
  const key = heldFromForged(me, keyEv, lock, place, 2)
  const gold = forgeKey('Gold Key')
  const goldEv = finalizeEvent(keyInnerTemplate(gold, at, 0, 1), sk) as NostrEvent
  const goldKey = heldFromForged(me, goldEv, gold, place, 1)
  const other = generateSecretKey()
  const noteEv = finalizeEvent(messageInnerTemplate('meet me at the obelisk', at, 0, 3), other) as NostrEvent
  const note: HeldItem = { rowKey: `${me}/${noteEv.id}`, owner: me, id: noteEv.id, type: 'message', name: 'A note', event: noteEv, author: noteEv.pubkey, verified: true, source: 'taken', place, from: { chestId: 'c'.repeat(64), chestName: 'Wind Chest' }, at: 3, text: 'meet me at the obelisk' }
  useShards.setState({ mine: [], discovered: {}, deleted: {} })
  useInventory.setState({ owner: me, items: { [key.id]: key, [goldKey.id]: goldKey, [note.id]: note }, storage: 'memory' })
  return { me, silver: key, restore: () => { useItemsModal.setState({ open: null }); useCyberspace.setState({ identity: was }) } }
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

/** Mount the panel and open one of its modals with its button. */
async function openKind(label: string): Promise<Awaited<ReturnType<typeof mount>>> {
  const m = await mount(createElement(InventoryPanel))
  await m.press(new RegExp(`^${label} · `))
  return m
}

describe('the ITEMS panel', () => {
  it('shows only two buttons, KEY ITEMS and OTHER LOOT with their counts, a lucide icon each and no emoji, and no rows, headings, PASTE or CLEAR ALL', async () => {
    expect(kindLabel(KEY_ITEMS_LABEL, 3)).toBe('KEY ITEMS · 3')
    expect(kindLabel(OTHER_LOOT_LABEL, 0)).toBe('OTHER LOOT · 0')
    const { restore } = seed()
    const m = await mount(createElement(InventoryPanel))
    const buttons = m.all().filter((h) => h.type === 'button').map(textOf)
    // Beside the house EXPLAIN toggle, which holds the one-line Explanation.
    expect(buttons.filter((b) => !/^EXPLAIN|^HIDE/i.test(b))).toEqual(['KEY ITEMS · 2', 'OTHER LOOT · 1'])
    expect(m.all().filter((h) => h.type === 'li')).toHaveLength(0)
    expect(m.all().filter((h) => h.type === 'input' || h.type === 'form')).toHaveLength(0)
    expect(m.says('Silver Key')).toBe(false)
    expect(m.says('A note')).toBe(false)
    expect(m.all().some((h) => cls(h) === 'legend__label')).toBe(false)
    // Each button is CREATE's (avatars__go shards__compose-open, in a shards__modes row), its icon first.
    const kinds = m.all().filter((h) => h.type === 'button' && /KEY ITEMS|OTHER LOOT/.test(textOf(h)))
    expect(cls(m.all().find((h) => cls(h).includes('items-kinds'))!).split(' ')).toContain('shards__modes')
    for (const b of kinds) {
      expect(cls(b).split(' ')).toEqual(expect.arrayContaining(['avatars__go', 'shards__compose-open']))
      expect((b.children[0] as { type: string }).type).toBe('svg')
      expect(textOf(b)).not.toMatch(/\p{Extended_Pictographic}/u)
    }
    expect(m.says('everything you\'ve taken from chests')).toBe(false)
    await m.press(/^EXPLAIN/i)
    expect(m.says('Key items open doors and chests. Other loot is everything you\'ve taken from chests.')).toBe(true)
    await m.unmount()
    restore()
  })

  it('counts 0 for an empty kind, and that modal says so in a line', async () => {
    const { restore } = seed()
    useInventory.setState({ items: {} })
    const m = await openKind(OTHER_LOOT_LABEL)
    expect(m.buttons(/^OTHER LOOT · 0$/)).toHaveLength(1)
    expect(m.buttons(/^KEY ITEMS · 0$/)).toHaveLength(1)
    expect(m.says(NO_OTHER_LOOT)).toBe(true)
    await m.press(/^✕$/)
    await m.press(/^KEY ITEMS · 0$/)
    expect(m.says(NO_KEY_ITEMS)).toBe(true)
    await m.unmount()
    restore()
  })
})

describe('the KEY ITEMS and OTHER LOOT modals', () => {
  it('KEY ITEMS lists only the key items, newest first, under MAY UNLOCK DOORS OR CHESTS, with PASTE; never the loot', async () => {
    const { restore } = seed()
    const m = await openKind(KEY_ITEMS_LABEL)
    const dialog = m.all().find((h) => h.props.role === 'dialog')!
    expect(dialog.props['aria-label']).toBe('Key items')
    expect(rowsOf(m.all(), false)).toHaveLength(0)
    expect(rowsOf(m.all(), true).map((r) => textOf(r))).toEqual([expect.stringContaining('Silver Key'), expect.stringContaining('Gold Key')])
    expect(m.says('A note')).toBe(false)
    expect(m.all().filter((h) => cls(h) === 'legend__label').map(textOf)).toEqual([KEY_ITEMS_NOTE])
    expect(m.buttons(/^PASTE$/)).toHaveLength(1)
    expect(m.buttons(/^CLEAR ALL$/)).toHaveLength(0)
    expect(m.buttons(/^MINE 2$/)).toHaveLength(1)
    expect(m.buttons(/^FEED$/)).toHaveLength(1)
    await m.unmount()
    restore()
  })

  it('OTHER LOOT lists only what is not a key item, with no X and no CLEAR ALL; never a key item, no PASTE, no FEED', async () => {
    const { restore } = seed()
    const m = await openKind(OTHER_LOOT_LABEL)
    expect(m.all().find((h) => h.props.role === 'dialog')!.props['aria-label']).toBe('Other loot')
    expect(rowsOf(m.all(), true)).toHaveLength(0)
    expect(rowsOf(m.all(), false)).toHaveLength(1)
    expect(m.says('Silver Key')).toBe(false)
    expect(m.all().some((h) => cls(h).includes('held__clear'))).toBe(false)
    expect(m.buttons(/^CLEAR ALL$/)).toHaveLength(0)
    // The title wears the Sparkles icon, not an emoji.
    const title = m.all().find((h) => cls(h) === 'items-modal__title')!
    expect(textOf(title)).toBe('OTHER LOOT')
    expect((title.children[0] as { type: string }).type).toBe('svg')
    expect(m.buttons(/^PASTE$/)).toHaveLength(0)
    expect(m.buttons(/^FEED$/)).toHaveLength(0)
    await m.unmount()
    restore()
  })

  it('are stacked: open over the menu, closed by ✕ or by Escape back to the panel, nothing left on the stack', async () => {
    const { restore } = seed()
    const m = await openKind(KEY_ITEMS_LABEL)
    expect(stackedOpen()).toBe(1)
    expect(topEscape()?.layer).toBe('modal')
    expect(escapeTop()).toBe(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(useItemsModal.getState().open).toBeNull()
    expect(m.all().some((h) => h.props.role === 'dialog')).toBe(false)
    expect(stackedOpen()).toBe(0)
    expect(topEscape()).toBeNull()
    // The panel is there again, as it was.
    expect(m.buttons(/^KEY ITEMS · 2$/)).toHaveLength(1)
    await m.press(/^OTHER LOOT · 1$/)
    expect(stackedOpen()).toBe(1)
    await m.press(/^✕$/)
    expect(stackedOpen()).toBe(0)
    await m.unmount()
    restore()
  })
})

describe('KEY ITEMS > FEED', () => {
  /** A verified listing as the feed holds one. */
  const listing = (name: string, lister: string, itemPubkey: string, createdAt: number): ItemListing => ({ id: `${name}-id`.padEnd(64, '0'), lister, itemPubkey, name, about: `about ${name}`, createdAt })

  it('lists published key items by other people, each NOT FOUND, never one you hold (by its keypair) nor your own listing', async () => {
    const { me, silver, restore } = seed()
    const was = useItemFeed.getState()
    const them = getPublicKey(generateSecretKey())
    const unheld = forgeKey('Moon Key')
    // Silver Key listed again by someone else under another name: still the key you hold.
    const feed = [
      listing('Moon Key', them, unheld.itemPubkey, 9),
      listing('Renamed Silver', them, silver.key!.itemPubkey, 8),
      listing('My Own Listing', me, forgeKey('Own').itemPubkey, 7),
    ]
    const load = vi.fn(async () => {})
    useItemFeed.setState({ listings: feed, loading: false, trouble: null, load })
    try {
      const m = await openKind(KEY_ITEMS_LABEL)
      await m.press(/^FEED$/)
      expect(load).toHaveBeenCalled()
      expect(m.says(FEED_LINE)).toBe(true)
      expect(m.says('Moon Key')).toBe(true)
      expect(m.says('Renamed Silver')).toBe(false)
      expect(m.says('My Own Listing')).toBe(false)
      // MINE's rows are not drawn under FEED.
      expect(m.says('Gold Key')).toBe(false)
      const rows = m.all().filter((h) => h.type === 'li' && cls(h).includes('held__row'))
      expect(rows).toHaveLength(1)
      expect(m.all().filter((h) => textOf(h) === 'NOT FOUND' && cls(h).split(' ').includes('tag'))).toHaveLength(1)
      // The lister's picture and name open their profile; DETAILS shows the item's keys; nothing publishes.
      expect(m.all().some((h) => cls(h).includes('profile-tap'))).toBe(true)
      await m.press(/^DETAILS$/)
      expect(m.says('about Moon Key')).toBe(true)
      expect(m.buttons(/PUBLISH|SEAL/)).toHaveLength(0)
      // Back to MINE: the held keys, Silver Key among them.
      await m.press(/^MINE 2$/)
      expect(m.says('Silver Key')).toBe(true)
      await m.unmount()
    } finally {
      useItemFeed.setState({ listings: was.listings, loading: was.loading, trouble: was.trouble, load: was.load })
      restore()
    }
  })

  it('takes a key out of FEED the moment you hold it', async () => {
    const { me, restore } = seed()
    const was = useItemFeed.getState()
    const them = generateSecretKey()
    const moon = forgeKey('Moon Key')
    useItemFeed.setState({ listings: [listing('Moon Key', getPublicKey(them), moon.itemPubkey, 9)], loading: false, trouble: null, load: async () => {} })
    try {
      const m = await openKind(KEY_ITEMS_LABEL)
      await m.press(/^FEED$/)
      expect(m.says('Moon Key')).toBe(true)
      const ev = finalizeEvent(keyInnerTemplate(moon, at, 0, 4), them) as NostrEvent
      const found = heldFromForged(me, ev, moon, place, 4)
      useInventory.setState({ items: { ...useInventory.getState().items, [found.id]: { ...found, source: 'found', author: ev.pubkey } } })
      await new Promise((r) => setTimeout(r, 20))
      expect(m.says('Moon Key')).toBe(false)
      expect(m.says('No one else has listed a key item yet.')).toBe(true)
      await m.press(/^MINE 3$/)
      expect(m.says('Moon Key')).toBe(true)
      await m.unmount()
    } finally {
      useItemFeed.setState({ listings: was.listings, load: was.load })
      restore()
    }
  })
})

describe('key item buttons', () => {
  it('are one ACTIONS button a row, opening DETAILS, COPY, PLACE, PUBLISH and ARCHIVE in a labelled line under it, all chest__act; no DELETE under MINE', async () => {
    const { restore } = seed()
    const m = await openKind(KEY_ITEMS_LABEL)
    const [held] = rowsOf(m.all(), true)
    expect(held).toBeDefined()
    // Closed: ACTIONS alone on each row.
    expect(buttonsIn(held).map(textOf)).toEqual(['ACTIONS'])
    expect(buttonsIn(held)[0].props['aria-expanded']).toBe(false)
    await m.press(/^ACTIONS$/)
    const [open] = rowsOf(m.all(), true)
    const heldButtons = buttonsIn(open)
    expect(heldButtons.map(textOf)).toEqual(['ACTIONS', 'DETAILS', 'COPY', 'PLACE', 'PUBLISH', 'ARCHIVE'])
    expect(heldButtons[0].props['aria-expanded']).toBe(true)
    const group = m.all().find((h) => cls(h) === 'held__menu')!
    expect(group.props.role).toBe('group')
    expect(group.props['aria-label']).toBe('Actions for Silver Key')
    expect(heldButtons[0].props['aria-controls']).toBe(group.props.id)
    for (const b of heldButtons) expect(cls(b).split(' ')).toContain('chest__act')
    expect(heldButtons.find((b) => textOf(b) === 'PUBLISH')!.props.disabled).toBe(false)
    // ACTIONS again hides them.
    await m.press(/^ACTIONS$/)
    expect(buttonsIn(rowsOf(m.all(), true)[0]).map(textOf)).toEqual(['ACTIONS'])
    await m.unmount()
    restore()
  })

  it('open one row at a time: the second key item’s ACTIONS closes the first’s', async () => {
    const { restore } = seed()
    const m = await openKind(KEY_ITEMS_LABEL)
    await m.press(/^ACTIONS$/)
    expect(m.all().filter((h) => cls(h) === 'held__menu')).toHaveLength(1)
    const second = buttonsIn(rowsOf(m.all(), true)[1]).find((b) => textOf(b) === 'ACTIONS')!
    ;(second.props.onClick as () => void)()
    await new Promise((r) => setTimeout(r, 20))
    expect(m.all().filter((h) => cls(h) === 'held__menu')).toHaveLength(1)
    expect(buttonsIn(rowsOf(m.all(), true)[0]).map(textOf)).toEqual(['ACTIONS'])
    expect(m.all().find((h) => cls(h) === 'held__menu')!.props['aria-label']).toBe('Actions for Gold Key')
    await m.unmount()
    restore()
  })

  it('in OTHER LOOT, a taken row shows ACTIONS alone; ACTIONS opens READ, DETAILS and ARCHIVE in chest__act, and READ reads it', async () => {
    const { restore } = seed()
    const m = await openKind(OTHER_LOOT_LABEL)
    const [row] = rowsOf(m.all(), false)
    expect(buttonsIn(row).map(textOf)).toEqual(['ACTIONS'])
    await m.press(/^ACTIONS$/)
    const taken = buttonsIn(rowsOf(m.all(), false)[0])
    expect(taken.map(textOf)).toEqual(['ACTIONS', 'READ', 'DETAILS', 'ARCHIVE'])
    for (const b of taken) expect(cls(b).split(' ')).toContain('chest__act')
    await m.press(/^READ$/)
    expect(m.says('meet me at the obelisk')).toBe(true)
    await m.unmount()
    restore()
  })

  it('close with Escape before the modal they are in, which the next Escape closes, leaving nothing on the Escape stack', async () => {
    const { restore } = seed()
    const m = await mount(createElement(InventoryPanel))
    expect(topEscape()).toBeNull()
    await m.press(/^KEY ITEMS/)
    await m.press(/^ACTIONS$/)
    expect(topEscape()?.layer).toBe('modal')
    expect(m.all().filter((h) => cls(h) === 'held__menu')).toHaveLength(1)
    expect(escapeTop()).toBe(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(m.all().filter((h) => cls(h) === 'held__menu')).toHaveLength(0)
    expect(m.all().some((h) => h.props.role === 'dialog')).toBe(true)
    expect(escapeTop()).toBe(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(m.all().some((h) => h.props.role === 'dialog')).toBe(false)
    expect(topEscape()).toBeNull()
    await m.unmount()
    restore()
  })

  it('say LISTED as a chip under the line of an item already in the ITEM FEED, never as a button, and offer no PUBLISH', async () => {
    const { restore } = seed()
    const was = useItemFeed.getState().listedBy
    useItemFeed.setState({ listedBy: () => true })
    try {
      const m = await openKind(KEY_ITEMS_LABEL)
      const row = rowsOf(m.all(), true)[0]
      const meta = m.all().find((h) => cls(h).split(' ').includes('item__meta') && /forged by you/.test(textOf(h)))!
      expect(textOf(meta)).not.toMatch(/LISTED/)
      const chips = m.all().find((h) => cls(h) === 'held__chips' && textOf(row).includes(textOf(h)))!
      expect(chips.children.filter((c): c is Host => typeof c !== 'string' && c.type === 'span').map(textOf)).toContain('LISTED')
      await m.press(/^ACTIONS$/)
      const held = buttonsIn(rowsOf(m.all(), true)[0]).map(textOf)
      expect(held).toEqual(['ACTIONS', 'DETAILS', 'COPY', 'PLACE', 'ARCHIVE'])
      expect(m.buttons(/LISTED|PUBLISH/)).toHaveLength(0)
      await m.unmount()
    } finally {
      useItemFeed.setState({ listedBy: was })
      restore()
    }
  })

  it('share one row layout with the OTHER LOOT rows: the taken row carries held__row--loot, and both classes are the same grid, the picture over two rows on the left, ACTIONS under the words on the right, what it opens across the whole row', async () => {
    const { restore } = seed()
    const m = await openKind(OTHER_LOOT_LABEL)
    const [taken] = rowsOf(m.all(), false)
    expect(cls(taken).split(' ')).toContain('held__row--loot')
    await m.unmount()
    restore()
    // Comments out, so a rule's selector is only its selector.
    const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const ruleFor = (part: string): string[] => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel]) => sel.split(',').some((x) => x.trim() === part)).map(([, , body]) => body)
    for (const row of ['.held__row--item', '.held__row--loot']) {
      expect(ruleFor(row).join(';')).toMatch(/display: grid;\s*grid-template-columns: var\(--chamfer-size, 80px\) minmax\(0, 1fr\)/)
      expect(ruleFor(`${row} > .chamfer`).join(';')).toMatch(/grid-column: 1; grid-row: 1 \/ span 2/)
      expect(ruleFor(`${row} > .item__line`).join(';')).toMatch(/grid-column: 2; grid-row: 1;/)
      expect(ruleFor(`${row} > .held__acts`).join(';')).toMatch(/grid-column: 2; grid-row: 2;.*justify-self: end;.*flex-wrap: wrap/)
      expect(ruleFor(`${row} > .held__menu`).join(';')).toMatch(/grid-column: 1 \/ -1/)
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

describe('the tutorial', () => {
  it('still finds ITEMS: the inventory step highlights the ITEMS slot, which holds this panel, and the build step names OTHER LOOT', async () => {
    const { INVENTORY, BUILD_PLACE } = await import('../../tutorial/script')
    expect(INVENTORY.scene?.highlight).toBe('[data-panel-id="items"]')
    expect(INVENTORY.hint).toMatch(/KEY ITEMS and OTHER LOOT/)
    expect(BUILD_PLACE.hint).toMatch(/^ITEMS: OTHER LOOT, ACTIONS, MOVE TO WORKSHOP\./)
    const hud = readFileSync(new URL('../Hud.tsx', import.meta.url), 'utf8')
    expect(hud).toMatch(/\n\s*items: InventoryPanel,/)
    const slot = readFileSync(new URL('../PanelSlot.tsx', import.meta.url), 'utf8')
    expect(slot).toMatch(/data-panel-id=\{id\}/)
  })
})

describe('leaving the modals for the world', () => {
  it('a PLACE that lines up closes the stack, so the scene is in view', async () => {
    const { restore } = seed()
    useShards.setState({ pending: null, deployStatus: 'idle' })
    const m = await openKind(KEY_ITEMS_LABEL)
    expect(stackedOpen()).toBe(1)
    await m.press(/^ACTIONS$/)
    await m.press(/^PLACE$/)
    expect(useShards.getState().pending).not.toBeNull()
    expect(stackedOpen()).toBe(0)
    expect(useItemsModal.getState().open).toBeNull()
    useShards.getState().cancelDeploy()
    await m.unmount()
    restore()
  })

  it('VIEW in DETAILS closes the stack before it flies there', async () => {
    const { restore } = seed()
    const was = useCyberspace.getState().viewAt
    const viewAt = vi.fn()
    useCyberspace.setState({ viewAt })
    try {
      const m = await openKind(KEY_ITEMS_LABEL)
      await m.press(/^ACTIONS$/)
      await m.press(/^DETAILS$/)
      await m.press(/^VIEW$/)
      expect(viewAt).toHaveBeenCalled()
      expect(stackedOpen()).toBe(0)
      expect(useItemsModal.getState().open).toBeNull()
      await m.unmount()
    } finally {
      useCyberspace.setState({ viewAt: was })
      restore()
    }
  })

  it('the modal closes with the panel: a menu hidden and shown again does not bring it back by itself', async () => {
    const { restore } = seed()
    const m = await openKind(OTHER_LOOT_LABEL)
    expect(useItemsModal.getState().open).toBe('loot')
    await m.unmount()
    expect(useItemsModal.getState().open).toBeNull()
    expect(stackedOpen()).toBe(0)
    restore()
  })
})

describe('a tap and the open ACTIONS', () => {
  /** An element as the closer reads it: which selectors it is inside, and the modal it is in. */
  const el = (inRow: boolean, modal: string | null) => ({
    closest: (sel: string) => (sel.startsWith('[data-actions-row') ? (inRow ? { classList: { contains: () => false } } : null) : modal ? { classList: { contains: (c: string) => modal.split(' ').includes(c) } } : null),
  })
  it('stay open for a tap in the row or in a confirmation it opened; close for a tap elsewhere in the ITEMS modal, or outside it', () => {
    expect(tapKeepsActions(el(true, 'modal items-modal'), 'r')).toBe(true)
    expect(tapKeepsActions(el(false, 'modal'), 'r')).toBe(true)
    expect(tapKeepsActions(el(false, 'modal items-modal'), 'r')).toBe(false)
    expect(tapKeepsActions(el(false, null), 'r')).toBe(false)
    expect(tapKeepsActions(null, 'r')).toBe(false)
  })
})

describe('FEED, filtered and paged', () => {
  const listing = (name: string, lister: string, createdAt: number): ItemListing => ({ id: `${name}`.padEnd(64, '0'), lister, itemPubkey: forgeKey(name).itemPubkey, name, about: '', createdAt })
  it('hides a listing by someone muted, and draws a long feed a page at a time', async () => {
    const { restore } = seed()
    const was = useItemFeed.getState()
    const mutedWas = useMutes.getState().muted
    const blocked = getPublicKey(generateSecretKey())
    const them = getPublicKey(generateSecretKey())
    const many = Array.from({ length: FEED_PAGE + 5 }, (_, i) => listing(`Key ${i}`, them, 1000 - i))
    useItemFeed.setState({ listings: [listing('Blocked Key', blocked, 2000), ...many], loading: false, trouble: null, load: async () => {} })
    useMutes.setState({ muted: { pubkeys: new Set([blocked]), items: new Set() } })
    try {
      const m = await openKind(KEY_ITEMS_LABEL)
      await m.press(/^FEED$/)
      expect(m.says('Blocked Key')).toBe(false)
      const rows = m.all().filter((h) => h.type === 'li' && cls(h).includes('held__row'))
      expect(rows).toHaveLength(FEED_PAGE)
      expect(m.says('Key 0')).toBe(true)
      expect(m.says(`Key ${FEED_PAGE + 4}`)).toBe(false)
      await m.unmount()
    } finally {
      useItemFeed.setState({ listings: was.listings, load: was.load })
      useMutes.setState({ muted: mutedWas })
      restore()
    }
  })
})
