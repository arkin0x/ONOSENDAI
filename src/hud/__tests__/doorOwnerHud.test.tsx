/**
 * doorOwnerHud.test.tsx: a door on the HUD for the one who sealed it (chest
 * and door design 4.2, 4.3, 4.7, 4.8, 4.11, R12). SEAL A DOOR is live and
 * PLACE DOOR its first step; its modal asks a name and a lock and has no ADD;
 * the card has BEHIND IT, HERE with SEAL and SEAL ALL, and EDIT · MOVE · ADD ·
 * DELETE; on another device before OPEN only DELETE; a stranger none; DELETE's
 * card has its one switch (R12); a chest of yours offers CONVERT TO DOOR.
 * Rendered to a string, each store brought up to date first.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../../lib/events'
import { sealEntries } from '../../lib/chests'
import { newDoorSecret, roomEntries } from '../../lib/doors'
import { chestInnerTemplate, chestItemOf, messageInnerTemplate, rumorOf, type BagEntry } from '../../lib/hidden'
import { keepDoorSecret, resetDoorSecrets } from '../../store/doorSecrets'
import { useBuilder } from '../../store/useBuilder'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useShards, type MyDeployment } from '../../store/useShards'
import { useWorkshop } from '../../store/useWorkshop'
import { ChestCompose } from '../ChestCompose'
import { deleteDoorWords, DoorOwnerBlock } from '../DoorOwner'
import { SecretModal } from '../SecretModal'
import { ShardsPanel } from '../ShardsPanel'

const at = { x: 0x31n, y: 0x22n, z: 0x13n }
const stored = { x: '49', y: '34', z: '19' }
const sk = generateSecretKey()
const ME = getPublicKey(sk)

function render(el: JSX.Element): string {
  for (const store of [useShards, useInventory, useCyberspace, useWorkshop, useBuilder] as const) Object.assign(store.getInitialState(), store.getState())
  return renderToStaticMarkup(el)
}

function doorRow(signer = sk): MyDeployment {
  const sealed = sealEntries(roomEntries(newDoorSecret()) as BagEntry[], getPublicKey(generateSecretKey()))
  const t = chestInnerTemplate({ name: 'North Door', lockPubkey: getPublicKey(generateSecretKey()), senderPubkey: sealed.senderPubkey, requires: 'the Silver Key', payload: sealed.payload, door: 4 }, at, 0, 1)
  const inner = finalizeEvent(t, signer) as NostrEvent
  return { eventId: inner.id, inner, type: 'chest', chest: chestItemOf(inner)!, bagId: 'bag', at: stored, plane: 0, height: 4, lookupId: 'lookup', keyHex: 'aa'.repeat(32), relays: [], createdAt: 1, published: false }
}

function noteRow(text: string, over: Partial<MyDeployment> = {}): MyDeployment {
  const inner = rumorOf(messageInnerTemplate(text, at, 0, 1), ME) as NostrEvent
  return { eventId: inner.id, inner, type: 'message', text, bagId: 'bag', at: stored, plane: 0, height: 4, lookupId: 'lookup', keyHex: 'aa'.repeat(32), relays: [], createdAt: 1, published: false, ...over }
}

/** The card's action buttons, in order. */
const actions = (html: string): string[] => {
  const row = html.slice(html.indexOf('secret__actions'))
  return [...row.slice(0, row.indexOf('</div>')).matchAll(/<button[^>]*>(?:<svg.*?<\/svg>)?([^<]*)<\/button>/g)].map((m) => m[1])
}

const identity = useCyberspace.getState().identity

beforeEach(() => {
  localStorage.removeItem('onosendai:door-secrets')
  resetDoorSecrets()
  useCyberspace.setState({ identity: { ...identity, pubkey: ME }, live: false })
  useShards.setState({ mine: [], discovered: {}, deleted: {}, deletedBags: {}, selectedSecret: null, curated: null, pending: null })
})

describe('SEAL A DOOR', () => {
  it('is live now, beside FORGE AN ITEM and SEAL A CHEST', () => {
    const html = render(<ShardsPanel />)
    const door = html.slice(html.lastIndexOf('<button', html.indexOf('SEAL A DOOR')), html.indexOf('SEAL A DOOR'))
    expect(door).not.toContain('disabled')
    expect(door).not.toContain('Soon')
  })

  it('its modal asks a name, a lock and what opens it, shows it in 3D, and has no contents', () => {
    useShards.getState().startPlaceDoor()
    useShards.getState().setDeployHeight(4)
    useShards.getState().placeChest()
    const html = render(<ChestCompose onDone={() => undefined} />)
    expect(html).toContain('secret__spin--look')
    expect(html).toContain('Name the door')
    expect(html).toContain('aria-label="Requires"')
    expect(html).toContain('SEAL (LOCAL)')
    for (const t of ['+ MESSAGE', '+ SHARD', '+ ITEM', '+ AUDIO']) expect(html).not.toContain(t)
    useShards.getState().cancelDeploy()
  })
})

describe('the door’s card', () => {
  it('for the device that sealed it: EDIT, MOVE, ADD, DELETE, never CONVERT', () => {
    const d = doorRow()
    keepDoorSecret(ME, d.eventId, 'a'.repeat(64))
    useShards.setState({ mine: [d], selectedSecret: d.eventId })
    const html = render(<SecretModal />)
    expect(actions(html).slice(1)).toEqual(['EDIT', 'MOVE', 'ADD', 'DELETE'])
    expect(html).toContain('BEHIND IT · 0')
    expect(html).not.toContain('CONVERT TO DOOR')
  })

  it('on another device, until it is opened: a finder’s card plus DELETE (4.11)', () => {
    const d = doorRow()
    useShards.setState({ mine: [d], selectedSecret: d.eventId })
    const html = render(<SecretModal />)
    expect(actions(html).slice(1)).toEqual(['DELETE'])
    expect(html).not.toContain('BEHIND IT')
  })

  it('BEHIND IT counts what is in its room; HERE lists what could be, with SEAL and SEAL ALL', () => {
    const d = doorRow()
    keepDoorSecret(ME, d.eventId, 'a'.repeat(64))
    const behind = noteRow('sealed', { room: { doorId: d.eventId }, lookupId: 'room' })
    const here = noteRow('out here')
    const higher = noteRow('higher', { height: 5 })
    useShards.setState({ mine: [d, behind, here, higher] })
    const html = render(<DoorOwnerBlock door={d} />)
    expect(html).toContain('BEHIND IT · 1')
    expect(html).toContain('HERE · 1')
    expect(html).toContain('out here')
    expect(html).not.toContain('higher')
    expect(html).toContain('>SEAL<')
    expect(html).toContain('>SEAL ALL<')
  })

  it('a chest of yours offers CONVERT TO DOOR', () => {
    const sealed = sealEntries([rumorOf(messageInnerTemplate('x', at, 0, 1), ME)], getPublicKey(generateSecretKey()))
    const inner = finalizeEvent(chestInnerTemplate({ name: 'Old Room', lockPubkey: getPublicKey(generateSecretKey()), senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload }, at, 0, 1), sk) as NostrEvent
    useShards.setState({ mine: [{ eventId: inner.id, inner, type: 'chest', chest: chestItemOf(inner)!, bagId: 'bag', at: stored, plane: 0, height: 4, lookupId: 'lookup', keyHex: 'aa'.repeat(32), relays: [], createdAt: 1, published: false }], selectedSecret: inner.id })
    expect(render(<SecretModal />)).toContain('CONVERT TO DOOR')
  })
})

describe('DELETE’s words (R12)', () => {
  it('off: DELETE DOOR, not red, what was behind it stays; on: the count, DELETE DOOR AND CONTENTS, red', () => {
    expect(deleteDoorWords(7, true, false)).toMatchObject({ confirmLabel: 'DELETE DOOR', danger: false })
    const on = deleteDoorWords(7, true, true)
    expect(on).toMatchObject({ confirmLabel: 'DELETE DOOR AND CONTENTS', danger: true })
    expect(on.lines[0]).toBe('Delete contents: 7 things.')
    expect(deleteDoorWords(1, true, true).lines[0]).toBe('Delete contents: 1 thing.')
  })

  it('one of several: the room stays, no contents to choose', () => {
    expect(deleteDoorWords(7, false, true)).toMatchObject({ confirmLabel: 'DELETE DOOR' })
  })
})
