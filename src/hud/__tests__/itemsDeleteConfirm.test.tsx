/**
 * itemsDeleteConfirm.test.tsx: an archived item's DELETE with the real
 * ConfirmModal (owner, 2026-11-14): Escape or a tap on the backdrop cancels
 * and keeps the item; only DELETE FOREVER removes it. The modal goes to
 * document.body through a portal, so the test gives it a body to land in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
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

import { createElement } from 'react'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../../lib/events'
import { messageInnerTemplate } from '../../lib/hidden'
import type { HeldItem } from '../../lib/inventory'
import { mount, textOf, type Host } from '../../test/elementRoot'
import { escapeTop } from '../../hooks/useEscape'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useShards } from '../../store/useShards'
import { DeleteItem } from '../InventoryPanel'

/** A body for the portal: a host as elementRoot makes them, so what lands in it can be read. */
const body = Object.defineProperties({ type: 'body', props: {}, children: [] as Array<Host | string> }, { nodeType: { value: 1 } }) as Host
const hadDocument = 'document' in globalThis
beforeEach(() => {
  body.children.length = 0
  if (!hadDocument) (globalThis as { document?: unknown }).document = { body }
})
afterEach(() => { if (!hadDocument) delete (globalThis as { document?: unknown }).document })

function all(h: Host | string, out: Host[] = []): Host[] {
  if (typeof h === 'string') return out
  out.push(h)
  h.children.forEach((c) => all(c, out))
  return out
}

function archivedNote(): HeldItem {
  const me = getPublicKey(generateSecretKey())
  useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: me } })
  const ev = finalizeEvent(messageInnerTemplate('meet me at the obelisk', { x: 1n, y: 2n, z: 3n }, 0, 3), generateSecretKey()) as NostrEvent
  const row: HeldItem = { rowKey: `${me}/${ev.id}`, owner: me, id: ev.id, type: 'message', name: 'A note', event: ev, author: ev.pubkey, verified: true, source: 'taken', place: null, from: null, at: 3, text: 'meet me at the obelisk', archived: 9 } as HeldItem
  useShards.setState({ mine: [] })
  useInventory.setState({ owner: me, items: { [row.id]: row }, storage: 'memory' })
  return row
}

describe('DELETE with the real confirmation', () => {
  it.skipIf(hadDocument)('Escape cancels and keeps the item', async () => {
    const row = archivedNote()
    const m = await mount(createElement(DeleteItem, { item: row }))
    await m.press(/^DELETE$/)
    expect(all(body).some((h) => h.props.role === 'dialog')).toBe(true)
    expect(escapeTop()).toBe(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(all(body).some((h) => h.props.role === 'dialog')).toBe(false)
    expect(useInventory.getState().items[row.id]).toBe(row)
    await m.unmount()
  })

  it.skipIf(hadDocument)('a tap on the backdrop cancels and keeps the item; DELETE FOREVER removes it', async () => {
    const row = archivedNote()
    const m = await mount(createElement(DeleteItem, { item: row }))
    await m.press(/^DELETE$/)
    const backdrop = all(body).find((h) => h.props.role === 'dialog')!
    expect(textOf(backdrop)).toContain('It leaves your ITEMS on this device.')
    ;(backdrop.props.onPointerDown as () => void)()
    await new Promise((r) => setTimeout(r, 20))
    expect(all(body).some((h) => h.props.role === 'dialog')).toBe(false)
    expect(useInventory.getState().items[row.id]).toBe(row)
    await m.press(/^DELETE$/)
    const confirm = all(body).find((h) => h.type === 'button' && textOf(h) === 'DELETE FOREVER')!
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    ;(confirm.props.onClick as () => void)()
    await new Promise((r) => setTimeout(r, 30))
    expect(useInventory.getState().items[row.id]).toBeUndefined()
    await m.unmount()
  })
})
