/**
 * chestItemChoice.test.tsx: + ITEM in the chest composer offers FROM MY ITEMS
 * and FORGE NEW (arkinox, 2026-11-09: "I don't get to choose existing items I
 * have nor properly configure a new item ... id like to customize the items I
 * place"). Driven by the composer's real buttons and the store's real seal.
 *
 * - FROM MY ITEMS lists only the items in ITEMS you made, not archived (the
 *   PLACE rule, arkinox 2026-11-06), and seals the chosen one as the same
 *   key: its keypair, secret and every tag.
 * - FORGE NEW is the whole forge: name, picture, model and motions, sealed as
 *   set. It is not held until taken out (arkinox, 2026-11-06), and TAKE holds
 *   it once; the lock list offers it as a key you made.
 * - CANCEL leaves nothing in the chest and nothing in ITEMS.
 * - A finder who opens the chest gets the item as configured.
 * - EDIT/ADD on a chest of yours offers the same two ways.
 *
 * Relays are mocked; no network. The Shard Feed and the model preview are
 * stand-ins, and the picture's canvas is a stub that hands back a tiny PNG.
 */
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

/** The PNG the stub canvas hands back for a picture. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
// The picture is drawn on a canvas from an Image (ItemForgeFields pictureFrom): stubs that load at once.
;(globalThis as { window?: unknown }).window ??= globalThis
;(globalThis as { document?: unknown }).document ??= {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  body: { nodeType: 1 },
  createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: () => undefined, imageSmoothingQuality: 'low' }), toDataURL: () => PNG }),
}
;(globalThis as { Image?: unknown }).Image = class {
  naturalWidth = 64
  naturalHeight = 48
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_: string) { setTimeout(() => this.onload?.(), 0) }
}

const MODEL_ADDRESS = `33331:${'cd'.repeat(32)}:lantern`
vi.mock('../../scene/CardSpin', () => ({ CardSpin: () => null }))
vi.mock('../../lib/relay', () => ({ publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []), queryEach: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))
// The Shard Feed: one object to pick.
vi.mock('../FeedList', () => ({
  FeedList: ({ onPick }: { onPick: (o: unknown) => void }) => <button onClick={() => onPick({ address: `33331:${'cd'.repeat(32)}:lantern`, event: { content: 'not json' }, seen: ['wss://relay.test'] })}>PICK LANTERN</button>,
}))
// The model, as if fetched; its preview stands in for the canvas (no WebGL here).
vi.mock('../../hooks/useItemModel', () => ({ useItemModel: (ref: unknown) => (ref ? { shard: { id: 'lantern', name: 'Lantern', unit: 0 } } : null) }))
vi.mock('../../scene/ItemModelPreview', () => ({ ItemModelPreview: ({ animation }: { animation: readonly string[] }) => <div role="img" aria-label={`preview ${animation.join(',')}`} /> }))
// Radix reads its DOM node; the motion switches as plain buttons.
vi.mock('../ui/Switch', () => ({
  Switch: ({ id, checked, onCheckedChange }: { id: string; checked: boolean; onCheckedChange: (v: boolean) => void }) => <button id={id} aria-checked={checked} onClick={() => onCheckedChange(!checked)}>{`switch ${id}`}</button>,
  Field: ({ children, label }: { children: JSX.Element; label: string }) => <div>{label}{children}</div>,
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../../lib/events'
import { forgeKey, openWithSecret, readContents } from '../../lib/chests'
import { chestItemOf, keyInnerTemplate, keyItemOf, messageInnerTemplate, type KeyItem } from '../../lib/hidden'
import { heldFromEntry, heldFromForged, sealableKeys, type HeldItem } from '../../lib/inventory'
import { mount, textOf, type Host, type Mounted } from '../../test/elementRoot'
import { useBuilder } from '../../store/useBuilder'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { chestCopiesOf, chestCopyOf, useShards, type MyDeployment } from '../../store/useShards'
import { useStash } from '../stash'
import { ChestCompose } from '../ChestCompose'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const I = () => useInventory.getState()
const at = { x: 1n, y: 2n, z: 3n }
const PLACE = { lookupId: 'l', bagId: 'b', at: { x: '1', y: '2', z: '3' }, plane: 0 as const, height: 4 }
const CURSOR = { x: (1n << 70n) + 0x1d3c5a7f9n, y: (1n << 60n) + 0x2b4n, z: (1n << 72n) + 0x7e5n }

let lock: KeyItem

beforeEach(() => {
  lock = forgeKey('Wind Key')
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, chestBack: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null, selectedSecret: null })
  useBuilder.getState().exit()
  useBuilder.setState({ itemDraft: null })
  useStash.getState().close()
  useStash.setState({ chestSaving: false })
  useInventory.setState({ owner: C().identity.pubkey, items: {}, storage: 'memory' })
  useCyberspace.setState({ live: false, position: CURSOR, anchor: CURSOR, cursor: CURSOR, spectate: null, exploreIndex: null, transit: null })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

/** A key this identity forged and picked up, with a picture, a model and a motion. */
async function ownHeld(name: string, extra: Partial<HeldItem> = {}): Promise<HeldItem> {
  const key: KeyItem = { ...forgeKey(name, 'made by me'), image: PNG, imageDim: { w: 1, h: 1 }, model: { address: MODEL_ADDRESS }, animation: ['bob', 'spin-y'] }
  // A tag this client does not write: a copy keeps it, a re-forge would not.
  const t = keyInnerTemplate(key, at, 0, 100)
  const event = await C().signEvent({ ...t, tags: [...t.tags, ['t', 'quest']] })
  return { ...heldFromForged(C().identity.pubkey, event, key, PLACE, 100 + Object.keys(I().items).length), ...extra }
}

/** ITEMS: two keys of yours (one archived), someone else's key, and a message of yours. */
async function stockItems(): Promise<{ mineKey: HeldItem }> {
  const mineKey = await ownHeld('Silver Key')
  const archived = await ownHeld('Old Key', { archived: 5 })
  const theirKey = forgeKey('Their Key')
  const theirs = finalizeEvent(keyInnerTemplate(theirKey, at, 0, 90), generateSecretKey()) as NostrEvent
  const msg = await C().signEvent(messageInnerTemplate('a note of mine', at, 0, 95))
  const note: HeldItem = { ...heldFromForged(C().identity.pubkey, msg, theirKey, PLACE, 95), type: 'message', text: 'a note of mine', key: undefined, name: 'a note of mine' }
  useInventory.setState({ items: { [mineKey.id]: mineKey, [archived.id]: archived, [theirs.id]: heldFromForged(C().identity.pubkey, theirs, theirKey, PLACE, 90), [msg.id]: note } })
  return { mineKey }
}

/** SEAL A CHEST placed at the cursor, its lock pasted, and the modal open on it. */
async function openPlaced(): Promise<Mounted> {
  S().startPlaceChest({ name: 'Wind Chest', lock: { pubkey: lock.itemPubkey, label: 'a pasted key' }, requires: '', contents: [] })
  S().setDeployHeight(4)
  S().placeChest()
  return mount(<ChestCompose onDone={() => undefined} />)
}

const byLabel = (m: Mounted, label: string): Host => {
  const h = m.all().find((x) => x.props['aria-label'] === label)
  if (!h) throw new Error(`nothing labelled ${label}`)
  return h
}
const type = async (m: Mounted, label: string, value: string): Promise<void> => {
  ;(byLabel(m, label).props.onChange as (e: unknown) => void)({ target: { value } })
  await new Promise((r) => setTimeout(r, 5))
}
/** The rows FROM MY ITEMS lists, by name. */
const listed = (m: Mounted): string[] => {
  const list = m.all().find((h) => h.props['aria-label'] === 'Item from your ITEMS')
  return list ? list.children.map((li) => textOf((li as Host).children[0] as Host)).map((t) => t.replace(/(NO MODEL|MODEL.*|IN CHEST)$/, '')) : []
}
const meterBytes = (m: Mounted): number => {
  const meter = m.all().find((h) => String(h.props.className ?? '').startsWith('compose__meter'))!
  return Number(/([\d,]+)\/65,535 B/.exec(textOf(meter))![1].replace(/,/g, ''))
}
const chestRow = (): MyDeployment | undefined => S().mine.find((d) => d.type === 'chest')
/** The chest's contents, opened with its lock as a finder would. */
const openChest = (d: MyDeployment) => readContents(openWithSecret(chestItemOf(d.inner)!, lock.secretHex))
const notC = (tags: string[][]): string[][] => tags.filter((t) => t[0] !== 'C')

async function sealIt(m: Mounted): Promise<MyDeployment> {
  await m.press('SEAL (LOCAL)')
  await vi.waitFor(() => expect(chestRow()).toBeDefined(), { timeout: 10_000 })
  expect(S().deployError).toBeNull()
  return chestRow()!
}

describe('+ ITEM: FROM MY ITEMS or FORGE NEW', () => {
  it('+ ITEM offers the two choices, and CANCEL goes back', async () => {
    const m = await openPlaced()
    await m.press('+ ITEM')
    expect(m.buttons('FROM MY ITEMS')).toHaveLength(1)
    expect(m.buttons('FORGE NEW')).toHaveLength(1)
    await m.press('CANCEL')
    expect(m.buttons('+ ITEM')).toHaveLength(1)
    await m.unmount()
    S().cancelDeploy()
  })

  it('FROM MY ITEMS lists only your own items, not archived, not taken from others, not messages', async () => {
    await stockItems()
    const m = await openPlaced()
    await m.press('+ ITEM')
    await m.press('FROM MY ITEMS')
    expect(listed(m)).toEqual(['Silver Key'])
    // Each row with its picture, and what it carries.
    expect(m.says('MODEL · BOB · ROTATE Y')).toBe(true)
    expect(m.all().some((h) => h.type === 'img' && h.props.src === PNG)).toBe(true)
    await m.unmount()
    S().cancelDeploy()
  })

  it('the rule itself: chestCopyOf refuses archived, someone else’s, unsigned and non-items', async () => {
    const me = C().identity.pubkey
    const mineKey = await ownHeld('Silver Key')
    expect(typeof chestCopyOf(mineKey, me)).toBe('object')
    expect(typeof chestCopyOf({ ...mineKey, archived: 1 }, me)).toBe('string')
    expect(typeof chestCopyOf({ ...mineKey, verified: false }, me)).toBe('string')
    expect(typeof chestCopyOf(mineKey, getPublicKey(generateSecretKey()))).toBe('string')
    expect(typeof chestCopyOf({ ...mineKey, type: 'message', text: 'hi', key: undefined }, me)).toBe('string')
    expect(chestCopiesOf({ [mineKey.id]: mineKey }, me).map((r) => r.item.id)).toEqual([mineKey.id])
  })

  it('a chosen item is sealed as the same key: keypair, secret and every tag; ITEMS keeps one row', async () => {
    const { mineKey } = await stockItems()
    const before = Object.keys(I().items).sort()
    const m = await openPlaced()
    const empty = meterBytes(m)
    await m.press('+ ITEM')
    await m.press('FROM MY ITEMS')
    await m.press('Silver Key')
    expect(m.says('Silver Key')).toBe(true)
    // The meter counts the whole item, picture and model tags included.
    expect(meterBytes(m) - empty).toBeGreaterThan(JSON.stringify(mineKey.event.tags).length)
    // Once in, it is marked so and cannot go in twice.
    await m.press('+ ITEM')
    await m.press('FROM MY ITEMS')
    expect(m.says('IN CHEST')).toBe(true)
    expect(m.buttons('Silver Key')[0].props.disabled).toBe(true)
    await m.press('CANCEL')
    const d = await sealIt(m)
    const [entry] = openChest(d)
    expect(entry.body.type).toBe('key')
    expect(keyItemOf(entry.event)).toEqual(keyItemOf(mineKey.event))
    expect(entry.event.content).toBe(mineKey.event.content)
    expect(notC(entry.event.tags)).toEqual(notC(mineKey.event.tags))
    expect(entry.event.tags).toContainEqual(['t', 'quest'])
    expect(entry.event.pubkey).toBe(C().identity.pubkey)
    expect(Object.keys(I().items).sort()).toEqual(before)
    await m.unmount()
  })

  it('FORGE NEW seals the item as configured: name, picture, model and motions; held only once taken, and once', async () => {
    const m = await openPlaced()
    await m.press('+ ITEM')
    await m.press('FORGE NEW')
    expect(m.buttons(/^ADD$/)[0].props.disabled).toBe(true)
    await type(m, 'Item name', 'Lantern Key')
    await type(m, 'About the item', 'it glows')
    ;(byLabel(m, 'Picture file').props.onChange as (e: unknown) => void)({ target: { files: [new File(['x'], 'p.png', { type: 'image/png' })], value: 'p.png' } })
    await vi.waitFor(() => expect(m.all().some((h) => h.type === 'img' && h.props.src === PNG)).toBe(true))
    await m.press('MODEL')
    await m.press('PICK LANTERN')
    await m.press('switch chest-item-motion-bob')
    await m.press('switch chest-item-motion-spin-x')
    expect(m.all().some((h) => h.props['aria-label'] === 'preview bob,spin-x')).toBe(true)
    await m.press(/^ADD$/)
    expect(m.says('Lantern Key')).toBe(true)
    // The forge is gone with ADD: nothing of it is left mounted.
    expect(m.all().some((h) => h.props['aria-label'] === 'Item name')).toBe(false)
    const d = await sealIt(m)
    const [entry] = openChest(d)
    const key = keyItemOf(entry.event)!
    expect(key.name).toBe('Lantern Key')
    expect(key.about).toBe('it glows')
    expect(key.image).toBe(PNG)
    expect(key.imageDim).toEqual({ w: 32, h: 24 })
    expect(key.model).toEqual({ address: MODEL_ADDRESS, relay: 'wss://relay.test' })
    expect(key.animation).toEqual(['bob', 'spin-x'])
    // Not held until taken out (arkinox, 2026-11-06); the lock list offers it, as a key you made.
    expect(Object.keys(I().items)).toHaveLength(0)
    expect(sealableKeys(I().items, S().mine, C().identity.pubkey).map((k) => k.name)).toContain('Lantern Key')
    // TAKE holds it once, marked as yours, however often it is taken.
    I().take([entry], { chestId: d.eventId, chestName: 'Wind Chest' }, PLACE)
    I().take([entry], { chestId: d.eventId, chestName: 'Wind Chest' }, PLACE)
    const rows = Object.values(I().items)
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toEqual(key)
    expect(rows[0].author).toBe(C().identity.pubkey)
    await m.unmount()
  })

  it('CANCEL on FORGE NEW or FROM MY ITEMS adds nothing, and leaves ITEMS as it was', async () => {
    await stockItems()
    const before = Object.keys(I().items).sort()
    const m = await openPlaced()
    await m.press('+ ITEM')
    await m.press('FORGE NEW')
    const npub = (): string => String(m.all().find((h) => h.type === 'button' && String(h.props.title ?? '').startsWith('npub'))?.props.title)
    const first = npub()
    expect(first).toMatch(/^npub1/)
    await type(m, 'Item name', 'Dropped Key')
    await m.press('CANCEL')
    expect(m.says('Dropped Key')).toBe(false)
    expect(m.says('Nothing inside yet.')).toBe(true)
    await m.press('+ ITEM')
    await m.press('FROM MY ITEMS')
    await m.press('CANCEL')
    expect(m.says('Nothing inside yet.')).toBe(true)
    // A new forge is a new keypair, and starts blank.
    await m.press('+ ITEM')
    await m.press('FORGE NEW')
    expect(byLabel(m, 'Item name').props.value).toBe('')
    expect(npub()).toMatch(/^npub1/)
    expect(npub()).not.toBe(first)
    await m.press('CANCEL')
    expect(Object.keys(I().items).sort()).toEqual(before)
    expect(S().pending?.type === 'chest' ? S().pending : null).toMatchObject({ contents: [] })
    await m.unmount()
    S().cancelDeploy()
  })

  it('a finder who opens the chest takes the configured item, not a blank one', async () => {
    const { mineKey } = await stockItems()
    const m = await openPlaced()
    await m.press('+ ITEM')
    await m.press('FROM MY ITEMS')
    await m.press('Silver Key')
    const d = await sealIt(m)
    await m.unmount()
    // Someone else, holding the lock, opens it and takes what is inside.
    const finder = getPublicKey(generateSecretKey())
    const [entry] = openChest(d)
    expect(entry.verified).toBe(true)
    const taken = heldFromEntry(finder, entry, { chestId: d.eventId, chestName: 'Wind Chest' }, PLACE, 200)
    expect(taken.type).toBe('key')
    expect(taken.key).toEqual(mineKey.key)
    expect(taken.key?.model?.address).toBe(MODEL_ADDRESS)
    expect(taken.key?.animation).toEqual(['bob', 'spin-y'])
    expect(taken.key?.image).toBe(PNG)
  })

  it('the lock list is unchanged by + ITEM: the keys you hold and made, nothing more', async () => {
    await stockItems()
    const m = await openPlaced()
    const options = (): string[] => {
      const select = byLabel(m, 'Seal to an item you hold or made')
      return select.children.map((o) => textOf(o as Host))
    }
    const was = options()
    expect(was).toEqual(['paste a public key below', ...sealableKeys(I().items, S().mine, C().identity.pubkey).map((k) => k.name)])
    await m.press('+ ITEM')
    await m.press('FROM MY ITEMS')
    await m.press('Silver Key')
    await m.press('+ ITEM')
    await m.press('FORGE NEW')
    await type(m, 'Item name', 'Inner Key')
    await m.press(/^ADD$/)
    expect(options()).toEqual(was)
    await m.unmount()
    S().cancelDeploy()
  })
})

describe('EDIT/ADD on a chest of yours', () => {
  it('offers the same two ways, and SAVE seals what was there with the new items', async () => {
    const { mineKey } = await stockItems()
    const m = await openPlaced()
    await m.press('+ MESSAGE')
    await type(m, 'Message to seal', 'inside')
    await vi.waitFor(() => expect(m.buttons(/^ADD/).some((b) => !b.props.disabled)).toBe(true))
    await m.press(/^ADD/)
    const d = await sealIt(m)
    await m.unmount()

    const e = await mount(<ChestCompose onDone={() => undefined} target={{ mode: 'edit', eventId: d.eventId, fields: false }} />)
    await vi.waitFor(() => expect(e.says('OPENING')).toBe(false))
    await e.press('+ ITEM')
    expect(e.buttons('FROM MY ITEMS')).toHaveLength(1)
    await e.press('FORGE NEW')
    await type(e, 'Item name', 'Second Key')
    await e.press('MODEL')
    await e.press('PICK LANTERN')
    await e.press('switch chest-item-motion-spin-y')
    await e.press(/^ADD$/)
    await e.press('+ ITEM')
    await e.press('FROM MY ITEMS')
    await e.press('Silver Key')
    await e.press('SAVE')
    await vi.waitFor(() => expect(chestRow()?.eventId).not.toBe(d.eventId), { timeout: 10_000 })
    const inside = openChest(chestRow()!)
    expect(inside.map((x) => x.body.text ?? x.body.key?.name)).toEqual(['inside', 'Second Key', 'Silver Key'])
    const second = keyItemOf(inside[1].event)!
    expect(second.model?.address).toBe(MODEL_ADDRESS)
    expect(second.animation).toEqual(['spin-y'])
    expect(keyItemOf(inside[2].event)).toEqual(keyItemOf(mineKey.event))
    await e.unmount()
  })
})
