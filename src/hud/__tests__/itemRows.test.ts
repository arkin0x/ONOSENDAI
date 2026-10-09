/**
 * itemRows.test.ts: the key line and the chest block, rendered (Keys and
 * Chests B1 §3.2). A key found says it is held. A chest says what it
 * requires and, with nothing held, offers no OPEN. Rendered to a string, so
 * this is the first render, and the stores read as they start: zustand hands
 * the server renderer its initial state, so what OPEN depends on (which held
 * key is the lock, or that the lock is the viewer) is proven on the pure
 * opener in chests.test.ts and on the deploy in keysChestsDeploy.test.ts.
 * The labels the bar and the Stash use for a key and a chest are checked
 * beside them.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex } from '../../lib/events'
import { forgeKey, sealEntries } from '../../lib/chests'
import { hiddenGlyph, hiddenLabel, messageInnerTemplate, type ChestItem } from '../../lib/hidden'
import { pendingEmpty, pendingName } from '../../store/useShards'
import { depName } from '../stash'
import { ChestBlock, KeyLine } from '../ItemRows'

const hider = generateSecretKey()
const hiderPk = getPublicKey(hider)
const at = { x: 1n, y: 2n, z: 3n }
const place = { lookupId: 'l', bagId: 'b', at: { x: '1', y: '2', z: '3' }, plane: 0 as const, height: 6 }

function chestTo(lock: string, requires: string): ChestItem {
  const note = finalizeEvent(messageInnerTemplate('inside', at, 0, 1), hider)
  const sealed = sealEntries([note], lock)
  return { name: 'Wind Chest', lockPubkey: lock, senderPubkey: sealed.senderPubkey, requires, payload: sealed.payload }
}

const visible = (el: JSX.Element): string => renderToString(el).replace(/<[^>]*>/g, ' ')

describe('the key line', () => {
  it('names the key, who forged it, and that it is held', () => {
    const text = visible(createElement(KeyLine, { name: 'Wind Key', author: hiderPk }))
    expect(text).toContain('Wind Key')
    expect(text).toContain('forged by')
    expect(text).toContain('IN YOUR LOOT')
  })
})

describe('the chest block', () => {
  it('says its name, what it requires and who hid it, and offers no OPEN with nothing held', () => {
    const key = forgeKey('Wind Key')
    const text = visible(createElement(ChestBlock, { id: 'c1', chest: chestTo(key.itemPubkey, 'the Wind Key'), author: hiderPk, place }))
    expect(text).toContain('Wind Chest')
    expect(text).toContain('REQUIRES: the Wind Key')
    expect(text).toContain('hidden by')
    expect(text).not.toContain('OPEN')
  })

  it('names what is needed in the hider’s words, or says only that an item is', () => {
    const text = visible(createElement(ChestBlock, { id: 'c2', chest: chestTo(getPublicKey(generateSecretKey()), ''), author: hiderPk, place }))
    expect(text).toContain('REQUIRES: an item you have not found')
    expect(text).not.toContain('TAKE')
  })
})

describe('what a key and a chest are called', () => {
  it('in the bar, the Stash and the rows', () => {
    const key = forgeKey('Wind Key')
    expect(pendingName({ type: 'key', key }, null)).toBe('Wind Key')
    expect(pendingEmpty({ type: 'key', key: { ...key, name: ' ' } }, null)).toBe(true)
    const draft = { type: 'chest' as const, name: 'Wind Chest', lock: { pubkey: key.itemPubkey, label: 'Wind Key' }, requires: '', contents: [] }
    expect(pendingName(draft, null)).toBe('Wind Chest')
    expect(pendingEmpty(draft, null)).toBe(true)
    expect(pendingEmpty({ ...draft, contents: [{ kind: 'message', text: 'x' }] }, null)).toBe(false)
    expect(hiddenLabel({ type: 'key', key })).toBe('Wind Key')
    expect(hiddenLabel({ type: 'chest', chest: chestTo(key.itemPubkey, '') })).toBe('Wind Chest')
    expect(hiddenGlyph('key')).toBe('⚷')
    expect(hiddenGlyph('chest')).toBe('▣')
    expect(hiddenGlyph('message', true)).toBe('₿')
    const dep = { eventId: 'e', lookupId: 'l', createdAt: 1, type: 'key' as const, key, height: 1, plane: 0 as const, published: true, at: { x: '1', y: '2', z: '3' }, keyHex: bytesToHex(hider), relays: [], bagId: 'b', inner: {} as never }
    expect(depName(dep)).toBe('Wind Key')
  })
})
