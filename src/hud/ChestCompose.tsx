/**
 * ChestCompose.tsx: the chest modal, before a chest is sealed and whenever
 * its hider changes what it holds (Keys and Chests B1 §3.1; chest and door
 * design R18, 3.1, 4.8).
 *
 * SEAL A CHEST places first (arkinox, 2026-10-26, R18: "placed first, then
 * filled with ADD"; 2026-10-31: "tap, choose location, choose contents"):
 * the hide bar picks the place, the model, SCALE, TURN, WALK and the height,
 * and PLACE CHEST fixes where it lands (useShards placeChest). This modal is
 * what comes next, `place`: the chest in 3D across the top, its name, its
 * lock, what opens it, and ADD. SEAL & PUBLISH (or LOCAL) seals and hides it
 * where it was placed; MOVE goes back to the bar with the draft kept.
 *
 * On a chest of yours already hidden, EDIT and ADD open the same modal on
 * what it holds (`edit`): its name, lock and label (EDIT), and its contents,
 * each one kept exactly as it was sealed unless taken out with ×, with ADD
 * for more. SAVE seals it again where it stands (useShards resealChest).
 *
 * A chest is sealed to an item in your ITEMS, to a listed item from the
 * ITEM FEED (arkinox, 2026-10-13), or to a pasted item public key or npub,
 * which seals it to a person. The select is text only: an <option> cannot
 * hold an item's picture. The meter shows the sealed size against NIP-44's
 * 65,535 bytes, and sealing is refused past it, in the same words the seal
 * would use.
 *
 * What is inside is taken, not placed (DECK-0004 §3.4, spec #82): nothing in
 * a chest is aimed at a point of its own any more. A door is for that.
 *
 * + ITEM offers two ways in (arkinox, 2026-11-09: "id like to customize the
 * items I place"). FROM MY ITEMS lists the items in your ITEMS that you made
 * (the PLACE rule, useShards chestCopyOf), each with its picture, and puts
 * the chosen one in as the same key with all its settings. FORGE NEW opens
 * the whole forge (ItemForgeFields, as FORGE AN ITEM): name, picture, model
 * and motions; ADD puts it in, CANCEL drops it with its keypair. Neither is
 * held until it is taken out (arkinox, 2026-11-06); the lock list still
 * offers it, as a key you made.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CardSpin } from '../scene/CardSpin'
import { readContents } from '../lib/chests'
import { entryKey, hiddenLabel, keyItemOf, KEY_KIND, type BagEntry, type HiddenType, type KeyItem } from '../lib/hidden'
import { turnShard } from '../lib/turn'
import { ItemFeedPicker } from './ItemFeedPicker'
import { lockFromListing } from '../lib/itemListing'
import { ItemFace, ItemIcon } from './ItemIcon'
import { ItemForgeFields } from './ItemForgeFields'
import { ShardFolders, modelEditedAt, modelName, modelRef, useNewestFirst } from './ShardFolders'
import { ShardThumb } from './ShardThumb'
import type { ShardModel } from 'sno-core/shards'
import { nip19 } from 'nostr-tools'
import { forgeKey, isLockPubkey, NIP44_MAX_PLAINTEXT, sizeRefusal, templateBytes } from '../lib/chests'
import { attributed } from '../lib/client'
import { MAX_ITEM_NAME, MAX_MESSAGE_LENGTH, messageInnerTemplate, shardInnerTemplate } from '../lib/hidden'
import { findCashuToken } from '../lib/cashu'
import { hasNftLink } from '../lib/nftLink'
import { useCyberspace } from '../store/useCyberspace'
import { useInventory } from '../store/useInventory'
import { sealableKeys } from '../lib/inventory'
import { chestCopiesOf, chestKeyTemplate, lookModelOf, placedDoorHeight, positionOf, useShards, type ChestContent, type ChestDraft, type ChestLock } from '../store/useShards'
import { creditOf, useWorkshop } from '../store/useWorkshop'
import { composeVerdict, SETTLE_MS, useCashu } from './useCashu'
import { useSettled } from './useSettled'
import { AudioUpload } from './AudioCompose'
import { audioInnerTemplate } from '../lib/audioItem'
import { useStash } from './stash'
import { lockOfHex } from '../lib/locks'
import { carriedLabel } from '../lib/keyringLocks'
import { keyringEntry, useKeyring, useRoomKeys } from '../store/useKeyring'
import type { KeyringLock } from '../lib/keyringLocks'
import { roomKey, roomKeyOf, roomLookupId } from '../lib/doors'
import { hexToBytes } from '../lib/events'
import { doorSecret } from '../store/doorSecrets'
import type { Hidden } from '../lib/hidden'
import type { MyDeployment } from '../store/useShards'
import { doorAsFound } from '../store/rooms'
import { REGION_REQUIRES, RegionLockPicker } from './RegionLockPicker'
import { RoomLockSelect } from './RoomLockSelect'

/** What opens it, as the LOCK block offers (arkinox, 2026-11-10): a key item, a person, a region, a room. */
type LockMode = 'item' | 'person' | 'region' | 'room'
const LOCK_MODES: Array<[LockMode, string, string]> = [
  ['item', 'KEY ITEM', 'Whoever holds the item opens it'],
  ['person', 'PERSON', 'Only that person opens it'],
  ['region', 'REGION', 'Whoever carries the region’s key opens it'],
  ['room', 'ROOM', 'Whoever opened the room opens it'],
]

/** A chest's lock as the composer shows it, when a region or room key you carry is what it asks for (DECK-0004 §3.8). */
function carriedLock(pubkey: string, e: KeyringLock): ChestLock {
  const k = e.key
  return k.kind === 'region'
    ? { pubkey, label: carriedLabel(k), kind: 'region', region: { from: 'keyring', height: k.height, lookupId: k.lookupId } }
    : { pubkey, label: carriedLabel(k), kind: 'room', room: { lookupId: k.lookupId } }
}

/**
 * Everything that names a door's own room, so ROOM never offers it, even when
 * a room key's door has not loaded here yet (review of #648): the ids of the
 * room's doors this device knows, and the room bag's `d` from a kept secret.
 */
function ownRoomRefs(ownRoom: string, me: string, mine: readonly MyDeployment[], discovered: Record<string, Hidden>, self: string | null): { doorIds: Set<string>; lookupIds: Set<string> } {
  const doorIds = new Set<string>(self ? [self] : [])
  const lookupIds = new Set<string>()
  for (const d of mine) {
    const h = d.chest?.door
    if (h === undefined || roomKeyOf({ at: positionOf(d), plane: d.plane, inner: d.inner }) !== ownRoom) continue
    doorIds.add(d.eventId)
    const secret = doorSecret(me, d.eventId)
    if (!secret || d.room || d.height !== h || !d.keyHex) continue
    try { lookupIds.add(roomLookupId(roomKey(hexToBytes(d.keyHex), hexToBytes(secret)))) } catch { /* a malformed row names nothing */ }
  }
  for (const f of Object.values(discovered)) if (f.type === 'chest' && roomKeyOf(f) === ownRoom) doorIds.add(f.eventId)
  return { doorIds, lookupIds }
}

/** A pasted npub, as a person's lock. */
function parsePerson(text: string): ChestLock | null {
  try {
    const d = nip19.decode(text.trim())
    if (d.type === 'npub' && isLockPubkey(d.data)) return { pubkey: d.data, label: 'a person' }
  } catch { /* not an npub */ }
  return null
}

/** A pasted lock: an item's public key as hex, or a person's npub; either must name a point on the curve. */
function parseLock(text: string): ChestLock | null {
  const t = text.trim()
  if (isLockPubkey(t)) return { pubkey: t, label: 'a pasted key' }
  try {
    const d = nip19.decode(t)
    if (d.type === 'npub' && isLockPubkey(d.data)) return { pubkey: d.data, label: 'a person' }
  } catch { /* not an npub */ }
  return null
}

/** A ten-digit time, the width every created_at has for decades, so the meter's count is the deploy's. */
const SAMPLE_CREATED_AT = 1_700_000_000

/** What a content row says. */
function contentLabel(c: ChestContent, shardName: (id: string) => string): string {
  if (c.kind === 'message') return findCashuToken(c.text) ? 'message with a cashu token' : hasNftLink(c.text) ? 'message with an NFT link' : c.text.trim().replace(/\s+/g, ' ').slice(0, 48)
  if (c.kind === 'shard') return shardName(c.shardId)
  if (c.kind === 'audio') return c.audio.title
  if (c.kind === 'sealed') return c.label
  return c.key.name
}

/** The item a content is, when it is one: added, or kept as sealed. */
function keyOf(c: ChestContent): KeyItem | null {
  if (c.kind === 'key') return c.key
  if (c.kind !== 'sealed' || c.type !== 'key') return null
  const e = c.entry as { kind?: unknown; content?: unknown; tags?: unknown }
  return e.kind === KEY_KIND && typeof e.content === 'string' && Array.isArray(e.tags) ? keyItemOf(e as Parameters<typeof keyItemOf>[0]) : null
}

/** The keypairs a chest's contents already hold: an item added, or one kept as sealed. */
function keypairsIn(contents: readonly ChestContent[]): Set<string> {
  const out = new Set<string>()
  for (const c of contents) {
    const k = keyOf(c)
    if (k) out.add(k.itemPubkey)
  }
  return out
}

/** What an item carries besides its name, in a word or two: its model and motions. */
function itemSettings(key: KeyItem): string {
  if (!key.model) return 'NO MODEL'
  const motions = (key.animation ?? []).map((a) => (a === 'bob' ? 'BOB' : a === 'spin-y' ? 'ROTATE Y' : 'ROTATE X'))
  return ['MODEL', ...motions].join(' · ')
}

/** What a row's icon is: its kind, a kept entry's own. */
function contentType(c: ChestContent): HiddenType {
  return c.kind === 'sealed' ? c.type : c.kind
}

/** What a chest of yours holds, as the modal lists it: each entry kept as sealed, named as its row would be. */
export function sealedContents(entries: BagEntry[], sealer: string): ChestContent[] {
  const read = new Map(readContents(entries, sealer).map((e) => [e.id, e]))
  const out: ChestContent[] = []
  for (const entry of entries) {
    const k = entryKey(entry)
    const r = typeof k === 'string' ? read.get(k) ?? [...read.values()].find((x) => (entry as { id?: string }).id === x.id) : undefined
    if (!r) { out.push({ kind: 'sealed', entry, label: 'something this client cannot read', type: 'message' }); continue }
    const body = r.body
    const label = body.type === 'message' ? (findCashuToken(body.text ?? '') ? 'message with a cashu token' : (body.text ?? '').trim().replace(/\s+/g, ' ').slice(0, 48)) : body.type === 'shard' ? body.shard?.name ?? 'model' : body.type === 'key' ? body.key?.name ?? 'item' : body.type === 'audio' ? body.audio?.title ?? 'audio' : body.type === 'chest' ? body.chest?.name ?? 'chest' : hiddenLabel(body, 48)
    out.push({ kind: 'sealed', entry, label, type: body.type })
  }
  return out
}

/** Which chest the modal is for: the one just placed, or one of yours already hidden (EDIT shows its name and lock, ADD only its contents). */
export type ChestModalMode = { mode: 'place' } | { mode: 'edit'; eventId: string; fields: boolean }

export function ChestCompose({ onDone, target = { mode: 'place' } }: { onDone: () => void; target?: ChestModalMode }): JSX.Element {
  const editing = target.mode === 'edit' ? target : null
  // A door: a name, a lock and what opens it, and no contents; what it locks is placed in the world (4.2).
  const isDoor = useShards((s) => (editing ? s.mine.find((d) => d.eventId === editing.eventId)?.chest?.door !== undefined : s.pending?.type === 'chest' && !!s.pending.door))
  // The chest being placed: what the bar handed over (useShards placeChest).
  const pending = useShards((s) => (s.pending?.type === 'chest' ? s.pending : null))
  const hidden = useShards((s) => (editing ? s.mine.find((d) => d.eventId === editing.eventId) ?? null : null))
  const me = useCyberspace((s) => s.identity.pubkey)
  const live = useCyberspace((s) => s.live)
  const items = useInventory((s) => s.items)
  // The keys you hold, and the keys you made and have not picked up: hiding
  // no longer holds a key (arkinox, 2026-11-06), and you can still seal to it.
  const mine = useShards((s) => s.mine)
  const keys = useMemo(() => sealableKeys(items, mine, me), [items, mine, me])
  const models = useWorkshop((s) => s.shards)
  // + SHARD's list: last edited or deployed first, as the workshop's (Workshop.tsx).
  const byRecent = useNewestFirst(models, modelRef, modelEditedAt)
  const modelOf = (id: string): ShardModel | undefined => models.find((s) => s.id === id)
  const shardName = (id: string): string => modelOf(id)?.name ?? 'model'

  // Where the draft starts: the placed chest's, or the hidden chest's own.
  const start = useMemo((): ChestDraft => {
    if (hidden?.chest) {
      const c = hidden.chest
      const held = keys.find((k) => k.key?.itemPubkey === c.lockPubkey)
      // A region or room you carry whose lock it is (DECK-0004 §3.8).
      const carried = held ? undefined : keyringEntry(c.lockPubkey)
      if (carried) return { name: c.name, requires: c.requires, contents: [], lock: carriedLock(c.lockPubkey, carried) }
      return { name: c.name, requires: c.requires, contents: [], lock: { pubkey: c.lockPubkey, label: held ? held.name : c.lockPubkey === me ? 'a person' : c.requires || 'its lock' } }
    }
    return pending ? { name: pending.name, lock: pending.lock, requires: pending.requires, contents: pending.contents } : { name: '', lock: null, requires: '', contents: [] }
    // Read once, when the modal opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [name, setName] = useState(start.name)
  const [requires, setRequires] = useState(start.requires)
  // A restored label that was never written still follows the lock once one is picked.
  const [requiresTouched, setRequiresTouched] = useState(start.requires.trim() !== '')
  // The lock it came with; EDIT may learn later that it is a region's or a room's (below).
  const [kept, setKept] = useState(start.lock)
  // Whether the hider has touched the lock: until then, EDIT may still recognise it.
  const [lockTouched, setLockTouched] = useState(false)
  // What opens it: the kind of the kept lock, else a key item, as before.
  const [mode, setMode] = useState<LockMode>(kept?.kind ?? (kept?.label === 'a person' ? 'person' : 'item'))
  const keptItem = kept && !kept.kind ? kept : null
  const [lockKeyId, setLockKeyId] = useState<string>(() => (keptItem ? keys.find((k) => k.key?.itemPubkey === keptItem.pubkey)?.id ?? '' : kept ? '' : keys[0]?.id ?? ''))
  // A lock chosen from the ITEM FEED: a listed item, held or not. A kept lock that is neither held, a person, pasted, a region nor a room came from there.
  const [feedLock, setFeedLock] = useState<ChestLock | null>(() => (keptItem && keptItem.label !== 'a person' && keptItem.label !== 'a pasted key' && !keys.some((k) => k.key?.itemPubkey === keptItem.pubkey) ? keptItem : null))
  const [picking, setPicking] = useState(false)
  const [pasted, setPasted] = useState(keptItem && keptItem.label === 'a pasted key' && !keys.some((k) => k.key?.itemPubkey === keptItem.pubkey) ? keptItem.pubkey : '')
  const [person, setPerson] = useState(keptItem?.label === 'a person' ? nip19.npubEncode(keptItem.pubkey) : '')
  // REGION's lock, computed by its picker; ROOM's choice, by room bag `d`.
  const [regionLock, setRegionLock] = useState<ChestLock | null>(kept?.kind === 'region' ? kept : null)
  const [roomId, setRoomId] = useState(kept?.kind === 'room' ? kept.room?.lookupId ?? '' : '')
  // The room keys you carry, for ROOM: read again as the keyring changes.
  const keyringVersion = useKeyring((s) => s.version)
  const allRooms = useRoomKeys()
  // EDIT opened before the keyring had derived this chest's lock: once it has, the lock reads as
  // the region or room it asks for, not as an unknown item (review of #648).
  useEffect(() => {
    const c = hidden?.chest
    if (!editing || lockTouched || !c || !kept || kept.kind || kept.label === 'a person' || keys.some((k) => k.key?.itemPubkey === c.lockPubkey)) return
    const e = keyringEntry(c.lockPubkey)
    if (!e) return
    const l = carriedLock(c.lockPubkey, e)
    setKept(l)
    setFeedLock(null)
    setLockKeyId('')
    if (l.kind === 'region') { setRegionLock(l); setMode('region') } else { setRoomId(l.room?.lookupId ?? ''); setMode('room') }
    // Asked again as the keyring grows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyringVersion])
  const [contents, setContents] = useState<ChestContent[]>(start.contents)
  // A hidden chest's contents, opened from what this device kept, or with what opens it.
  const [loading, setLoading] = useState(!!editing && !isDoor)
  const [status, setStatus] = useState<string | null>(null)
  const lostKeys = useShards((s) => s.lostKeys)
  // What is inside could not be read here: sealing it again would wipe it, so nothing goes in or out.
  const [unread, setUnread] = useState(false)
  const saving = useStash((s) => s.chestSaving)
  useEffect(() => {
    if (!editing || isDoor) return
    let on = true
    void useShards.getState().chestEntries(editing.eventId).then((r) => {
      if (!on) return
      setLoading(false)
      if (typeof r === 'string') { setStatus(r); setUnread(true) }
      // Behind what was added while it opened, which stays.
      else setContents((list) => [...sealedContents(r, hidden?.inner.pubkey ?? me), ...list])
    })
    return () => { on = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // What is being added: one editor open at a time.
  // + ITEM: `item` asks FROM MY ITEMS or FORGE NEW; `mine` lists your own; `forge` is the forge.
  const [adding, setAdding] = useState<'message' | 'shard' | 'item' | 'mine' | 'forge' | 'audio' | null>(null)
  const [text, setText] = useState('')
  // FORGE NEW's item, its keypair made when the forge opens; dropped by CANCEL.
  const [forging, setForging] = useState<KeyItem | null>(null)
  const ownItems = useMemo(() => chestCopiesOf(items, me), [items, me])
  const updateForging = useCallback((f: (k: KeyItem) => KeyItem) => setForging((k) => (k ? f(k) : k)), [])

  // Rooms, as roomKeyOf says them (signer, plane, height, corner): a door's own, and the one a chest or door stands in.
  const roomOfKey = (doorId: string): string | null => { const d = doorAsFound(doorId); return d ? roomKeyOf(d) : null }
  const ownRoom = isDoor ? (hidden ? roomKeyOf({ at: positionOf(hidden), plane: hidden.plane, inner: hidden.inner }) : pending?.spot ? roomKeyOf({ at: pending.spot.at, plane: pending.spot.plane, inner: { pubkey: me, tags: [['door', String(placedDoorHeight(useShards.getState()))]] } }) : null) : null
  const roomSnap = useShards((s) => s.deployRoomSnap)
  const standsIn = hidden ? (hidden.room ? roomOfKey(hidden.room.doorId) : null) : roomSnap ? `${me}:${roomSnap.room}` : null
  // A door never locks to its own room: whoever could open it would already be inside.
  // Every render: a handful of rooms, and the doors they name may arrive after the room keys do.
  const discoveredNow = useShards((s) => s.discovered)
  const own = ownRoom ? ownRoomRefs(ownRoom, me, mine, discoveredNow, hidden?.eventId ?? null) : null
  const rooms = own ? allRooms.filter((r) => r.kind !== 'room' || !(own.doorIds.has(r.doorId) || own.lookupIds.has(r.lookupId) || roomOfKey(r.doorId) === ownRoom)) : allRooms
  const heldLock = mode === 'item' ? keys.find((k) => k.id === lockKeyId) : undefined
  const room = rooms.find((r) => r.lookupId === roomId) ?? (mode === 'room' && !roomId ? rooms[0] : undefined)
  const roomLock = useMemo((): ChestLock | null => {
    if (!room) return kept?.kind === 'room' && kept.room?.lookupId === roomId ? kept : null
    const l = lockOfHex(room.keyHex)
    return l ? { pubkey: l.pubkey, label: room.kind === 'room' && room.name ? `the room ${room.name}` : 'a room', kind: 'room', room: { lookupId: room.lookupId } } : null
  }, [room, roomId, kept])
  const lock: ChestLock | null = mode === 'region' ? regionLock
    : mode === 'room' ? roomLock
      : mode === 'person' ? parsePerson(person)
        : heldLock?.key ? { pubkey: heldLock.key.itemPubkey, label: heldLock.name } : feedLock ?? parseLock(pasted)
  // The hider's label of what opens it starts as the lock's own name until typed over.
  useEffect(() => {
    if (requiresTouched) return
    setRequires(mode === 'region' ? REGION_REQUIRES : mode === 'room' ? 'the key of a room' : heldLock ? `the ${heldLock.name}` : feedLock && mode === 'item' ? `the ${feedLock.label}` : lock?.label === 'a person' ? 'being the one it was sealed for' : '')
  }, [mode, heldLock, feedLock, lock?.label, requiresTouched])
  // Locked to the room it stands in: whoever reaches it has opened that room already.
  const lockedInOwnRoom = mode === 'room' && !!room && room.kind === 'room' && !!standsIn && roomOfKey(room.doorId) === standsIn
  // Where the chest stands and its height, for REGION's default: as placed, or as hidden.
  const deployHeight = useShards((s) => s.deployHeight)
  const spot = hidden ? { at: positionOf(hidden), plane: hidden.plane } : pending?.spot ?? null
  const chestHeight = hidden ? hidden.height : deployHeight

  // A Cashu token in a message is read, and its mint asked, once the text holds still.
  const settled = useSettled(text, SETTLE_MS) === text
  const cashu = useCashu(adding === 'message' && settled ? text : null)
  const verdict = composeVerdict(settled, cashu)

  // The sealed size, as the seal will see it: every content as the event it
  // becomes, built the way sealChest builds it (useShards), each template
  // attributed with the client tag the signer adds, a created_at as wide as
  // the real one; a kept entry as it is.
  const bytes = useMemo(() => {
    const at = { x: 0n, y: 0n, z: 0n }
    const kept = contents.filter((c): c is Extract<ChestContent, { kind: 'sealed' }> => c.kind === 'sealed').map((c) => c.entry)
    const templates = contents.flatMap((c) => {
      if (c.kind === 'sealed') return []
      if (c.kind === 'message') return [attributed(messageInnerTemplate(c.text.trim(), at, 0, SAMPLE_CREATED_AT))]
      if (c.kind === 'key') return [attributed(chestKeyTemplate(c, at, 0, SAMPLE_CREATED_AT))]
      if (c.kind === 'audio') return [attributed(audioInnerTemplate(c.audio, at, 0, SAMPLE_CREATED_AT))]
      if (c.aimed) { const { kind, created_at, tags, content } = c.aimed.signed; return [{ kind, created_at, tags, content }] }
      const model = models.find((s) => s.id === c.shardId)
      return [attributed(model ? shardInnerTemplate(model, at, 0, SAMPLE_CREATED_AT, creditOf(model)) : messageInnerTemplate('', at, 0, SAMPLE_CREATED_AT))]
    })
    const fresh = templateBytes(templates, me || '0'.repeat(64))
    // Two JSON lists joined: the kept entries' bytes, less their brackets, and a comma between.
    if (kept.length === 0) return fresh
    const old = new TextEncoder().encode(JSON.stringify(kept)).length
    return templates.length === 0 ? old : old + fresh - 1
  }, [contents, models, me])
  const refusal = sizeRefusal(bytes)

  const add = (c: ChestContent): void => { setContents((list) => [...list, c]); setAdding(null); setText(''); setForging(null) }
  const inChest = useMemo(() => keypairsIn(contents), [contents])
  const forgeNew = (): void => { setForging(forgeKey('')); setAdding('forge') }
  const dropForge = (): void => { setForging(null); setAdding(null) }
  const remove = (i: number): void => setContents((list) => list.filter((_, j) => j !== i))
  // An editor open (FORGE NEW above all): SEAL, SAVE and MOVE wait, so a configured item and its keypair are never dropped unseen (review of #627).
  const midAdd = adding !== null
  const MID_ADD = 'ADD OR CANCEL THE ITEM FIRST'
  const ready = name.trim().length > 0 && !!lock && (isDoor || contents.length > 0) && !refusal && !loading && !unread && !midAdd
  const current = (): ChestDraft => ({ name: name.trim(), lock, requires: requires.trim(), contents })
  // Placing: the draft rides on the chest being placed, so closing the modal (back to the bar) keeps it.
  useEffect(() => {
    if (!editing) useShards.getState().keepChestDraft({ name: name.trim(), lock, requires: requires.trim(), contents })
    // lock is derived from these three
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, name, requires, contents, lockKeyId, feedLock, pasted, mode, person, regionLock, roomLock])

  // Placing: the deploy's own state, shown here while the bar is out of the way.
  const deployStatus = useShards((s) => s.deployStatus)
  const deployNote = useShards((s) => s.deployNote)
  const deployError = useShards((s) => s.deployError)
  const ask = useShards((s) => s.deployAsk)
  const working = deployStatus === 'working' || saving
  const seal = (): void => {
    if (!ready || !lock) return
    if (editing) {
      useStash.setState({ chestSaving: true }); setStatus(null)
      const saved = isDoor ? useShards.getState().resealDoor(editing.eventId, { name: name.trim(), requires: requires.trim(), lock }) : useShards.getState().resealChest(editing.eventId, { ...current(), lock })
      void saved.then(
        (why) => { useStash.setState({ chestSaving: false }); if (why) setStatus(why); else onDone() },
        (e: unknown) => { useStash.setState({ chestSaving: false }); setStatus(e instanceof Error ? e.message : 'It could not be saved.') },
      )
      return
    }
    void useShards.getState().sealPlacedChest({ ...current(), lock })
  }
  // MOVE before it is sealed: back to the hide bar, the draft kept on the chest being placed.
  const move = (): void => { if (midAdd) return; useShards.getState().unplaceChest(current()); onDone() }
  const cancel = (): void => { if (!editing) useShards.getState().cancelDeploy(true); onDone() }

  // The chest in 3D across the top, as it will stand: the model the bar chose, turned as the bar turned it.
  const turn = useShards((s) => s.deployTurn)
  const look = useMemo(() => {
    if (editing || !pending?.look) return null
    const m = lookModelOf(pending.look)
    return m ? turnShard(m, turn) : null
  }, [editing, pending?.look, turn])
  const fields = !editing || editing.fields

  return (
    <div className="shards__compose">
      {look && <div className="secret__spin secret__spin--look"><CardSpin shard={look} size={150} wide /></div>}
      {fields && <input className="avatars__input" value={name} onChange={(e) => setName(e.target.value.slice(0, MAX_ITEM_NAME))} placeholder={isDoor ? 'Name the door' : 'Name the chest'} maxLength={MAX_ITEM_NAME} autoFocus={!editing || editing.fields} aria-label={isDoor ? 'Door name' : 'Chest name'} />}

      {/* The LOCK block, one for chests and doors: this place always, then what opens it. */}
      {fields && (
        <div className="lock">
          <span className="legend__label">LOCK · WHAT OPENS IT</span>
          <span className="lock__note">THIS PLACE · always</span>
          <div className="compose__row" role="radiogroup" aria-label="What opens it">
            {LOCK_MODES.filter(([m]) => m !== 'room' || rooms.length > 0 || mode === 'room').map(([m, label, title]) => (
              <button key={m} className={`chest__act ${mode === m ? 'is-on' : ''}`} role="radio" aria-checked={mode === m} onClick={() => { setMode(m); setLockTouched(true) }} title={title}>{label}</button>
            ))}
          </div>
        </div>
      )}
      {fields && mode === 'item' && (
        <div className="compose__row">
          <select className="avatars__input compose__select" value={lockKeyId} onChange={(e) => { setLockTouched(true); setLockKeyId(e.target.value); if (e.target.value) setFeedLock(null) }} aria-label="Seal to an item you hold or made" title={`An item you hold or made: whoever holds it opens the ${isDoor ? 'door' : 'chest'}`}>
            <option value="">{keys.length === 0 ? 'no items yet' : 'paste a public key below'}</option>
            {keys.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
          <button className="chest__act" onClick={() => setPicking(true)} title="Choose a listed item from the ITEM FEED, even one you have never held">ITEM FEED</button>
        </div>
      )}
      {fields && mode === 'item' && !heldLock && feedLock && (
        <div className="compose__row">
          <span className="item__name" title={feedLock.pubkey}>sealed to {feedLock.label}, from the item feed</span>
          <button className="chest__act" onClick={() => setFeedLock(null)} aria-label="Clear the item feed lock" title="Clear this lock">×</button>
        </div>
      )}
      {picking && (
        <ItemFeedPicker
          onClose={() => setPicking(false)}
          onPick={(l) => {
            const held = keys.find((k) => k.key?.itemPubkey === l.itemPubkey)
            if (held) { setLockKeyId(held.id); setFeedLock(null) } else { setLockKeyId(''); setFeedLock(lockFromListing(l)) }
            setPasted('')
            setLockTouched(true)
            setPicking(false)
          }}
        />
      )}
      {fields && mode === 'item' && !heldLock && !feedLock && (
        <input className={`avatars__input ${pasted.trim() && !lock ? 'is-bad' : ''}`} value={pasted} onChange={(e) => { setLockTouched(true); setPasted(e.target.value) }} placeholder="an item public key (hex) or an npub" spellCheck={false} autoComplete="off" aria-label="Seal to a pasted public key" title="An item’s public key seals it to that item; an npub seals it to that person" />
      )}
      {fields && mode === 'person' && (
        <input className={`avatars__input ${person.trim() && !lock ? 'is-bad' : ''}`} value={person} onChange={(e) => { setLockTouched(true); setPerson(e.target.value) }} placeholder="an npub" spellCheck={false} autoComplete="off" aria-label="Seal to a person" title="Only this person opens it, with their own signer" />
      )}
      {fields && mode === 'region' && (
        <RegionLockPicker spot={spot} chestHeight={chestHeight} noun={isDoor ? 'door' : 'chest'} kept={kept?.kind === 'region' ? kept : null} onLock={setRegionLock} />
      )}
      {fields && mode === 'room' && (
        <RoomLockSelect rooms={rooms} value={room?.lookupId ?? roomId} keptLabel={!room && kept?.kind === 'room' ? kept.label : null} onPick={(id) => { setLockTouched(true); setRoomId(id) }} />
      )}
      {fields && lockedInOwnRoom && <span className="chest__status" role="status">This {isDoor ? 'door' : 'chest'} stands in that room. Whoever opens the room opens it.</span>}
      {fields && <input className="avatars__input" value={requires} onChange={(e) => { setRequires(e.target.value.slice(0, MAX_ITEM_NAME)); setRequiresTouched(true) }} placeholder="What opens it, for those who cannot" maxLength={MAX_ITEM_NAME} aria-label="Requires" title={`Shown to anyone who finds the ${isDoor ? 'door' : 'chest'} without its key`} />}

      {/* The contents, one editor at a time. A door has none. */}
      {isDoor ? null : <>
      {loading && <span className="chest__status" role="status">OPENING</span>}
      {contents.length > 0 && (
        <ul className="compose__list">
          {contents.map((c, i) => (
            <li key={i} className="chest__row">
              {c.kind === 'shard' && modelOf(c.shardId) ? <ShardThumb shard={modelOf(c.shardId)!} own /> : keyOf(c) ? <ItemFace className="chest__glyph chest__glyph--key" type="key" image={keyOf(c)?.image} /> : <ItemIcon className={`chest__glyph chest__glyph--${c.kind === 'message' && findCashuToken(c.text) ? 'cashu' : contentType(c)}`} type={contentType(c)} coin={c.kind === 'message' && !!findCashuToken(c.text)} />}
              <span className="item__name" title={contentLabel(c, shardName)}>{contentLabel(c, shardName)}</span>
              <button className="chest__act" onClick={() => remove(i)} aria-label="Take it out" title="Take it out of the chest">×</button>
            </li>
          ))}
        </ul>
      )}
      {unread ? null : adding === null ? (
        <div className="compose__row">
          <button className="chest__act" onClick={() => setAdding('message')} title="A message, which may hold a cashu token">+ MESSAGE</button>
          <button className="chest__act" onClick={() => setAdding('shard')} disabled={models.length === 0} title={models.length === 0 ? 'Nothing in your workshop yet' : 'One of your workshop models'}>+ SHARD</button>
          <button className="chest__act" onClick={() => setAdding('item')} title="An item you made, or a new one forged here">+ ITEM</button>
          <button className="chest__act" onClick={() => setAdding('audio')} title="An audio file, encrypted and uploaded now">+ AUDIO</button>
        </div>
      ) : adding === 'audio' ? (
        <AudioUpload idPrefix="chest-audio" submitLabel="ADD" onReady={(audio) => add({ kind: 'audio', audio })} onCancel={() => setAdding(null)} />
      ) : adding === 'message' ? (
        <>
          <textarea className="shards__textarea" value={text} onChange={(e) => setText(e.target.value.slice(0, MAX_MESSAGE_LENGTH))} placeholder="A message, or a cashu token" rows={3} autoFocus aria-label="Message to seal" />
          {verdict.note && <span className={`shards__compose-note shards__compose-note--${verdict.tone}`} role="status">{verdict.note}</span>}
          <div className="compose__row">
            <button className="chest__act" onClick={() => { setAdding(null); setText('') }}>CANCEL</button>
            <button className="chest__act" disabled={!text.trim() || !verdict.ready} onClick={() => add({ kind: 'message', text: text.trim() })}>ADD</button>
          </div>
        </>
      ) : adding === 'shard' ? (
        <>
          <ul className="objpick__list compose__models" aria-label="Model to seal">
            <ShardFolders items={byRecent} refOf={modelRef} nameOf={modelName} row={(s, f) => (
              <li key={s.id} {...f.drag}>
                <button className="objpick__row" onClick={() => add({ kind: 'shard', shardId: s.id })} title={`Seal "${s.name}" in the chest`}>
                  <ShardThumb shard={s} own />
                  <span className="objpick__name">{s.name}</span>
                  <span className="objpick__meta">{s.vertices.length} v · {s.faces.length} f{s.parts?.length ? ` · ${s.parts.length} obj` : ''}</span>
                </button>
                {f.tool}
              </li>
            )} />
          </ul>
          <div className="compose__row">
            <button className="chest__act" onClick={() => setAdding(null)}>CANCEL</button>
          </div>
        </>
      ) : adding === 'item' ? (
        <div className="compose__row">
          <button className="chest__act" onClick={() => setAdding('mine')} title="The same item, every setting kept: only items you made">FROM MY ITEMS</button>
          <button className="chest__act" onClick={forgeNew} title="Forge a new item: name, picture, model and motions">FORGE NEW</button>
          <button className="chest__act" onClick={() => setAdding(null)}>CANCEL</button>
        </div>
      ) : adding === 'mine' ? (
        <>
          {ownItems.length === 0
            ? <span className="chest__status" role="status">NO ITEMS YOU MADE</span>
            : (
              <ul className="objpick__list compose__models" aria-label="Item from your ITEMS">
                {ownItems.map(({ item, content }) => {
                  const there = inChest.has(content.key.itemPubkey)
                  // The chest's own lock: sealed inside, it would open nothing from outside (review of #627).
                  const isLock = lock?.pubkey === content.key.itemPubkey
                  const blocked = there || isLock
                  return (
                    <li key={item.id}>
                      <button className="objpick__row" disabled={blocked} onClick={() => add(content)} title={there ? 'Already in this chest' : isLock ? 'This item is the chest’s lock' : `Seal "${item.name}" in the chest, the same item`}>
                        <ItemFace className="chest__glyph chest__glyph--key" type="key" image={content.key.image} />
                        <span className="objpick__name">{item.name}</span>
                        <span className="objpick__meta">{there ? 'IN CHEST' : isLock ? 'IS THE LOCK' : itemSettings(content.key)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          <div className="compose__row">
            <button className="chest__act" onClick={() => setAdding('item')}>BACK</button>
            <button className="chest__act" onClick={() => setAdding(null)}>CANCEL</button>
          </div>
        </>
      ) : forging ? (
        <>
          {/* Its own heading, so its name is not read as the chest's. */}
          <span className="legend__label">NEW ITEM</span>
          <ItemForgeFields item={forging} onChange={updateForging} idPrefix="chest-item" />
          <div className="compose__row">
            <button className="chest__act" onClick={dropForge}>CANCEL</button>
            <button className="chest__act" disabled={!forging.name.trim()} onClick={() => add({ kind: 'key', key: { ...forging, name: forging.name.trim(), about: forging.about.trim() } })} title="Put the item in the chest">ADD</button>
          </div>
        </>
      ) : null}

      {/* The one hard limit, as a meter. */}
      <div className={`compose__meter ${refusal ? 'is-over' : ''}`} title="NIP-44 seals at most 65,535 bytes">
        <span>{refusal ?? (contents.length === 0 ? 'Nothing inside yet.' : `sealed to ${lock ? lock.label : 'nothing yet'}`)}</span>
        <span>{bytes.toLocaleString('en-US')}/{NIP44_MAX_PLAINTEXT.toLocaleString('en-US')} B</span>
      </div>
      </>}

      {(status ?? (editing ? null : deployError)) && <span className="chest__status notice" role="status">{status ?? deployError}</span>}
      {/* EDIT or ADD refused for dropping the last copy of a key (useShards keysLost): ARCHIVE keeps it, then SEAL again. */}
      {editing && status && lostKeys && <button className="chest__act" onClick={() => { useShards.getState().archiveLost(); setStatus('ARCHIVED') }} title="File the key away in ITEMS under ARCHIVED, then seal again">ARCHIVE</button>}
      {!editing && ask ? (
        <div className="shards__actions">
          <button className="avatars__go" onClick={() => useShards.getState().confirmDeploy()}>{ask.sats !== null ? `${ask.sats} SATS` : 'SEAL VIA HOSAKA'}</button>
          <button className="avatars__go" onClick={() => useShards.getState().declineDeploy()}>NOT NOW</button>
        </div>
      ) : (
        <div className="shards__actions">
          <button className="avatars__go" onClick={cancel} disabled={working}>CANCEL</button>
          {!editing && <button className="avatars__go" onClick={move} disabled={working || midAdd} title={midAdd ? MID_ADD : 'Back to the hide bar, to place it somewhere else'}>MOVE</button>}
          <button className="avatars__go" disabled={!ready || working} onClick={seal} title={midAdd ? MID_ADD : refusal ?? (!lock ? 'Pick what opens it' : !isDoor && contents.length === 0 ? 'Put something in it first' : editing ? 'Seal it again where it stands' : undefined)}>
            {working ? (deployNote && !editing ? `${deployNote.toUpperCase()}…` : 'SEALING…') : editing ? 'SAVE' : live ? 'SEAL & PUBLISH' : 'SEAL (LOCAL)'}
          </button>
        </div>
      )}
    </div>
  )
}
