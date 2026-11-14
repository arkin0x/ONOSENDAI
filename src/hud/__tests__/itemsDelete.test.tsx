/**
 * itemsDelete.test.tsx: no X buttons, no CLEAR ALL, and DELETE only on an
 * archived item, red, in its ACTIONS, removing nothing until its
 * confirmation (owner, 2026-11-14: "Delete should only happen after
 * confirmation from a red "DELETE" button in the archive item's actions. No
 * X Buttons. I'm afraid to press Clear All ... get rid of it"). Mounted and
 * pressed; the confirmation is drawn inline so its buttons can be pressed.
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
// The mint is never asked: a coin here reads UNCLAIMED.
vi.mock('../useCashu', async (orig) => ({ ...(await orig<typeof import('../useCashu')>()), useCashu: (text: string | null) => (text ? { found: true, token: null, state: 'unclaimed' } : { found: false, token: null, state: 'unknown' }) }))
// The confirmation drawn in place, its title, words and two buttons.
vi.mock('../ConfirmModal', async () => {
  const { createElement: h } = await import('react')
  return {
    ConfirmModal: (p: { title: string; body: unknown; confirmLabel: string; cancelLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) =>
      h('div', { className: `confirm ${p.danger ? 'confirm--danger' : ''}`, role: 'alertdialog' },
        h('h3', null, p.title), h('p', { className: 'confirm__body' }, p.body as string),
        h('button', { onClick: p.onConfirm }, p.confirmLabel), h('button', { onClick: p.onCancel }, p.cancelLabel ?? 'CANCEL')),
  }
})

import { createElement } from 'react'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../../lib/events'
import { forgeKey } from '../../lib/chests'
import { keyInnerTemplate, messageInnerTemplate } from '../../lib/hidden'
import { heldFromForged, type HeldItem } from '../../lib/inventory'
import { mount, textOf, type Host } from '../../test/elementRoot'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useShards } from '../../store/useShards'
import { InventoryPanel, deleteWarning, useItemsModal } from '../InventoryPanel'

const at = { x: 1n, y: 2n, z: 3n }
const place = { lookupId: 'l', bagId: 'b', at: { x: '1', y: '2', z: '3' }, plane: 0 as const, height: 4 }
const COIN = 'cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vbWludC50ZXN0IiwicHJvb2ZzIjpbXX1dfQ'

/** You, a key you forged, a note and a coin taken out of a chest; `archived` files the given ids away. */
function seed(archived: Array<'key' | 'note' | 'coin'> = []): { key: HeldItem; note: HeldItem; coin: HeldItem; restore: () => void } {
  const was = useCyberspace.getState().identity
  const sk = generateSecretKey()
  const me = getPublicKey(sk)
  useCyberspace.setState({ identity: { ...was, pubkey: me }, live: false })
  const lock = forgeKey('Silver Key')
  const key = heldFromForged(me, finalizeEvent(keyInnerTemplate(lock, at, 0, 2), sk) as NostrEvent, lock, place, 2)
  const other = generateSecretKey()
  const taken = (text: string, name: string, n: number): HeldItem => {
    const ev = finalizeEvent(messageInnerTemplate(text, at, 0, n), other) as NostrEvent
    return { rowKey: `${me}/${ev.id}`, owner: me, id: ev.id, type: 'message', name, event: ev, author: ev.pubkey, verified: true, source: 'taken', place, from: { chestId: 'c'.repeat(64), chestName: 'Wind Chest' }, at: n, text }
  }
  const note = taken('meet me at the obelisk', 'A note', 3)
  const coin = taken(`for you ${COIN}`, 'A coin', 4)
  const rows: Record<string, HeldItem> = {}
  for (const [name, it] of [['key', key], ['note', note], ['coin', coin]] as const) rows[it.id] = archived.includes(name) ? { ...it, archived: 9 } : it
  useShards.setState({ mine: [], discovered: {}, deleted: {} })
  useInventory.setState({ owner: me, items: rows, storage: 'memory' })
  return { key, note, coin, restore: () => { useItemsModal.setState({ open: null }); useCyberspace.setState({ identity: was }) } }
}

const cls = (h: Host): string => String(h.props.className ?? '')
/** Every button under an element. */
function buttonsUnder(h: Host): Host[] {
  const out: Host[] = []
  const walk = (n: Host | string): void => { if (typeof n !== 'string') { if (n.type === 'button') out.push(n); n.children.forEach(walk) } }
  walk(h)
  return out
}
/**
 * The X buttons on screen: the old held__clear, anything labelled CLEAR, and
 * inside a row any ✕ or a button with an icon and no words. The modal's own
 * close in its head is not a row's.
 */
const xButtons = (hosts: Host[]): Host[] => {
  const rows = hosts.filter((h) => h.type === 'li' && cls(h).includes('held__row'))
  const inRows = rows.flatMap(buttonsUnder).filter((b) => /^[✕×xX]?$/.test(textOf(b).trim()))
  return [...hosts.filter((h) => h.type === 'button' && (cls(h).includes('held__clear') || /^CLEAR/i.test(String(h.props['aria-label'] ?? textOf(h))))), ...inRows]
}
/** The row's buttons, by its item's name. */
function rowButtons(hosts: Host[], name: string): string[] {
  const row = hosts.find((h) => h.type === 'li' && cls(h).includes('held__row') && textOf(h).includes(name))
  const out: string[] = []
  const walk = (n: Host | string): void => { if (typeof n !== 'string') { if (n.type === 'button') out.push(textOf(n)); n.children.forEach(walk) } }
  if (row) walk(row)
  return out
}

beforeEach(() => {
  useInventory.setState({ items: {} })
})

async function open(label: RegExp): Promise<Awaited<ReturnType<typeof mount>>> {
  const m = await mount(createElement(InventoryPanel))
  await m.press(label)
  return m
}

describe('no X and no CLEAR ALL', () => {
  it('OTHER LOOT has neither, in INVENTORY or ARCHIVED; a coin row has none either', async () => {
    const { restore } = seed(['note'])
    const m = await open(/^OTHER LOOT · 1$/)
    expect(m.all().filter((h) => h.type === 'li' && cls(h).includes('held__row--loot'))).toHaveLength(1)
    expect(m.says('UNCLAIMED')).toBe(true)
    expect(xButtons(m.all())).toHaveLength(0)
    expect(m.buttons(/CLEAR ALL/)).toHaveLength(0)
    await m.press(/^ARCHIVED 1$/)
    expect(m.says('A note')).toBe(true)
    expect(xButtons(m.all())).toHaveLength(0)
    expect(m.buttons(/CLEAR ALL/)).toHaveLength(0)
    await m.unmount()
    restore()
  })

  it('KEY ITEMS has neither, in MINE or ARCHIVED', async () => {
    const { restore } = seed()
    const m = await open(/^KEY ITEMS · 1$/)
    expect(xButtons(m.all())).toHaveLength(0)
    await m.press(/^ACTIONS$/)
    await m.press(/^ARCHIVE$/)
    await m.press(/^ARCHIVED 1$/)
    expect(xButtons(m.all())).toHaveLength(0)
    expect(m.buttons(/CLEAR ALL/)).toHaveLength(0)
    await m.unmount()
    restore()
  })
})

describe('ARCHIVE from ACTIONS', () => {
  it('files an OTHER LOOT row away under ARCHIVED, still held, and UNARCHIVE brings it back', async () => {
    const { note, restore } = seed()
    const m = await open(/^OTHER LOOT · 2$/)
    const toggles = m.all().filter((h) => h.type === 'button' && textOf(h) === 'ACTIONS' && String(h.props['aria-label']) === 'Actions for A note')
    ;(toggles[0].props.onClick as () => void)()
    await new Promise((r) => setTimeout(r, 20))
    await m.press(/^ARCHIVE$/)
    expect(useInventory.getState().items[note.id].archived).toBeGreaterThan(0)
    expect(useInventory.getState().items[note.id].cleared).toBeUndefined()
    expect(m.buttons(/^INVENTORY 1$/)).toHaveLength(1)
    await m.press(/^ARCHIVED 1$/)
    await m.press(/^ACTIONS$/)
    await m.press(/^UNARCHIVE$/)
    expect(useInventory.getState().items[note.id].archived).toBeUndefined()
    await m.unmount()
    restore()
  })
})

describe('DELETE', () => {
  it('is never in the ACTIONS of a row under INVENTORY or MINE', async () => {
    const { restore } = seed()
    const loot = await open(/^OTHER LOOT · 2$/)
    const toggles = loot.all().filter((h) => h.type === 'button' && textOf(h) === 'ACTIONS')
    expect(toggles).toHaveLength(2)
    for (const toggle of toggles) {
      ;(toggle.props.onClick as () => void)()
      await new Promise((r) => setTimeout(r, 20))
      // Open: ARCHIVE is there, DELETE is not.
      expect(loot.buttons(/^ARCHIVE$/)).toHaveLength(1)
      expect(loot.buttons(/DELETE/)).toHaveLength(0)
    }
    await loot.unmount()
    useItemsModal.setState({ open: null })
    const keys = await open(/^KEY ITEMS · 1$/)
    await keys.press(/^ACTIONS$/)
    expect(rowButtons(keys.all(), 'Silver Key')).toContain('ARCHIVE')
    expect(keys.buttons(/DELETE/)).toHaveLength(0)
    await keys.unmount()
    restore()
  })

  it('on an archived row is red, in ACTIONS, and pressing it removes nothing until DELETE FOREVER', async () => {
    const { note, restore } = seed(['note'])
    const m = await open(/^OTHER LOOT · 1$/)
    await m.press(/^ARCHIVED 1$/)
    expect(m.buttons(/^DELETE$/)).toHaveLength(0)
    await m.press(/^ACTIONS$/)
    const [del] = m.buttons(/^DELETE$/)
    expect(cls(del).split(' ')).toEqual(['chest__act', 'chest__act--danger'])
    expect(rowButtons(m.all(), 'A note')).toEqual(['ACTIONS', 'READ', 'DETAILS', 'UNARCHIVE', 'DELETE'])
    await m.press(/^DELETE$/)
    // Asked, not done.
    expect(useInventory.getState().items[note.id]).toBeDefined()
    const ask = m.all().find((h) => h.props.role === 'alertdialog')!
    expect(cls(ask)).toContain('confirm--danger')
    expect(textOf(ask)).toContain('Delete “A note”?')
    expect(textOf(ask)).toContain('It leaves your ITEMS on this device.')
    expect(textOf(ask)).not.toMatch(/—/)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await m.press(/^DELETE FOREVER$/)
    expect(useInventory.getState().items[note.id]).toBeUndefined()
    expect(m.says('A note')).toBe(false)
    await m.unmount()
    restore()
  })

  it('CANCEL keeps the item, and DELETE asks again next time', async () => {
    const { note, restore } = seed(['note'])
    const m = await open(/^OTHER LOOT · 1$/)
    await m.press(/^ARCHIVED 1$/)
    await m.press(/^ACTIONS$/)
    await m.press(/^DELETE$/)
    await m.press(/^CANCEL$/)
    expect(useInventory.getState().items[note.id]).toEqual(expect.objectContaining({ id: note.id, archived: 9 }))
    expect(m.all().some((h) => h.props.role === 'alertdialog')).toBe(false)
    expect(m.says('A note')).toBe(true)
    await m.press(/^DELETE$/)
    expect(m.all().some((h) => h.props.role === 'alertdialog')).toBe(true)
    expect(useInventory.getState().items[note.id]).toBeDefined()
    await m.unmount()
    restore()
  })

  it('a row unarchived while its confirmation is open is refused at DELETE FOREVER, never deleted', async () => {
    const { note, restore } = seed(['note'])
    const m = await open(/^OTHER LOOT · 1$/)
    await m.press(/^ARCHIVED 1$/)
    await m.press(/^ACTIONS$/)
    await m.press(/^DELETE$/)
    const confirm = m.buttons(/^DELETE FOREVER$/)[0]
    // Unarchived from elsewhere (another tab, a test) while the confirmation stood open.
    useInventory.getState().unarchive(note.id)
    ;(confirm.props.onClick as () => void)()
    await new Promise((r) => setTimeout(r, 30))
    expect(useInventory.getState().items[note.id]).toBeDefined()
    await m.unmount()
    restore()
  })

  it('a delete that fails keeps the item and says so', async () => {
    const { note, restore } = seed(['note'])
    const was = useInventory.getState().remove
    useInventory.setState({ remove: async () => false })
    try {
      const m = await open(/^OTHER LOOT · 1$/)
      await m.press(/^ARCHIVED 1$/)
      await m.press(/^ACTIONS$/)
      await m.press(/^DELETE$/)
      await m.press(/^DELETE FOREVER$/)
      expect(useInventory.getState().items[note.id]).toBeDefined()
      expect(m.says('Could not delete it from this device. It is still held.')).toBe(true)
      expect(m.all().some((h) => h.props.role === 'alertdialog')).toBe(false)
      await m.unmount()
    } finally {
      useInventory.setState({ remove: was })
      restore()
    }
  })

  it('on an archived coin not redeemed says the sats are lost', async () => {
    const { coin, restore } = seed(['coin'])
    const m = await open(/^OTHER LOOT · 1$/)
    await m.press(/^ARCHIVED 1$/)
    await m.press(/^ACTIONS$/)
    await m.press(/^DELETE$/)
    const ask = m.all().find((h) => h.props.role === 'alertdialog')!
    expect(textOf(ask)).toContain('This coin is not redeemed. Deleting it loses the sats.')
    await m.press(/^CANCEL$/)
    expect(useInventory.getState().items[coin.id]).toBeDefined()
    await m.unmount()
    restore()
  })

  it('on an archived key item asks first too, naming its secret key', async () => {
    const { key, restore } = seed(['key'])
    const m = await open(/^KEY ITEMS · 0$/)
    await m.press(/^ARCHIVED 1$/)
    await m.press(/^ACTIONS$/)
    await m.press(/^DELETE$/)
    expect(useInventory.getState().items[key.id]).toBeDefined()
    expect(textOf(m.all().find((h) => h.props.role === 'alertdialog')!)).toContain('Its secret key leaves this device.')
    await m.press(/^CANCEL$/)
    expect(useInventory.getState().items[key.id]).toBeDefined()
    await m.unmount()
    restore()
  })
})

describe('what the confirmation says is lost', () => {
  it('names sats for a coin not known redeemed, an NFT for a claim link, and the secret key for a key item', () => {
    const coin = { type: 'message' as const, text: COIN }
    expect(deleteWarning(coin, 'unclaimed')).toBe('This coin is not redeemed. Deleting it loses the sats. Open its CARD and redeem it first.')
    expect(deleteWarning(coin, 'unknown')).toMatch(/^This coin may not be redeemed\. If it is not, deleting it loses the sats\./)
    expect(deleteWarning(coin, 'checking')).toMatch(/loses the sats/)
    expect(deleteWarning(coin, 'redeemed')).toMatch(/^This coin is already redeemed\./)
    expect(deleteWarning({ type: 'message', text: `for you https://nonfungible.cash/claim/${'6f'.repeat(16)}#${'A'.repeat(43)}` })).toMatch(/loses the NFT/)
    expect(deleteWarning({ type: 'key', text: undefined })).toMatch(/^Its secret key leaves this device\./)
    expect(deleteWarning({ type: 'shard', text: undefined })).toBe('It leaves your ITEMS on this device. It comes back only if you find it and TAKE it again.')
    for (const s of [deleteWarning(coin, 'unclaimed'), deleteWarning({ type: 'chest', text: undefined })]) expect(s).not.toMatch(/—/)
  })
})
