/**
 * useShards.ts — hiding things at a location, and everything visible in the world.
 *
 * A hidden thing is a shard or a text message: a signed inner event, kept in a
 * region BAG — one location-encrypted kind:33330 envelope per (author, region,
 * height), holding every item that author hid there. Deploying reads the bag,
 * appends the new item, and rewrites it (spec §8.6: keyed by d=lookup_id, and
 * addressable, so the newer bag replaces the old). One envelope, many items, no
 * per-item tags. Height is the discovery radius (spec §7.3): 0 is a single
 * gibson; higher hides it across a wider aligned cube that costs more to find.
 *
 * A bag also says three things in public, chosen in the deploy bar: whether
 * it carries its height (`H`), a sector hint, and a riddle (lib/hidden.ts
 * BagSettings). They belong to the bag, so deploying into a region that
 * already holds your bag starts from that bag's settings and every rewrite
 * carries them forward (arkinox, 2026-10-01).
 *
 * `mine` is what this identity deployed, placed from this device or found by a
 * scan after another device placed it, kept with each item's signed inner
 * event so a bag can be rebuilt without the relay; `discovered` is what a scan
 * turned up near you and could decrypt and verify.
 *
 * Two more item kinds hide the same way (Keys and Chests B1): a key, a keypair
 * the hider forges, and a chest, contents sealed to a key's or a person's
 * public key (lib/chests.ts). A chest's contents are signed here one by one
 * and sealed before the region key is computed; a key hidden, alone or inside
 * a chest, goes into the hider's own inventory at once (store/useInventory.ts).
 * A key a scan reads is found, and held once it is taken (takeFound,
 * arkinox, 2026-10-26: "i want to TAKE them"). A shard inside a
 * chest may be aimed first (startDeployIntoChest, arkinox 2026-10-10): signed
 * through the deploy bar where it should stand when the chest opens, and
 * sealed as it is.
 */

import { findCashuToken } from '../lib/cashu'
import { hasNftLink } from '../lib/nftLink'
import { clampUnit, normalizeStored } from 'sno-core/shards'
import { snapOffered, wrapSpin } from '../lib/pose'
import { create } from 'zustand'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from './useCyberspace'
import { publishMany, query, queryChecked, queryEach, relaySet } from '../lib/relay'
import { forgetReference, resolveReference } from '../lib/references'
import { unbagRemembered } from '../lib/foundCache'
import { bagAddressOf, bagsToOpen, retractedAt, staleFinds } from '../lib/bagVersions'
import { itemTargetOf, type ItemTarget } from '../lib/comments'
import { bytesToHex, hexToBytes, positionHex, type EventTemplate, type NostrEvent } from '../lib/events'
import { getEventHash } from 'nostr-tools/pure'
import { attributed } from '../lib/client'
import { regionKeyOffThread } from '../lib/regionKeyOffThread'
import { WRONG_KEY, keyFitsLookup, wrongKeyMessage } from '../lib/regionKeyCheck'
import { signedTableOnly } from '../lib/carried'
import { deployCeiling, deployRoute, localKeyCeiling, needsAsk, regionKeyQuote } from '../lib/deployPlan'
import { useSecrets } from './useSecrets'
import {
  BagUnreadable,
  DEFAULT_BAG_SETTINGS,
  HIDDEN_KIND,
  bagEntries,
  bagSettingsOf,
  resolveBagSettings,
  type BagSettings,
  bagInners,
  bagTemplate,
  entryKey,
  linkKey,
  objectTemplate,
  objectTemplateOf,
  OBJECT_KIND,
  dOf,
  editedTemplate,
  movedTemplate,
  itemLineage,
  referenceTo,
  wantsReference,
  REFERENCE_THRESHOLD_BYTES,
  type BagEntry,
  type Reference,
  type Rumor,
  chestInnerTemplate,
  chestItemOf,
  keyInnerTemplate,
  messageInnerTemplate,
  rumorOf,
  messagePreview,
  shardInnerTemplate,
  shardRefusal,
  unbag,
  type ChestItem,
  type Hidden,
  type HiddenType,
  type KeyItem,
  MESSAGE_KIND,
  CHEST_KIND,
  KEY_KIND,
  keyItemOf,
  isReference,
  learnSealed,
} from '../lib/hidden'
import { dnaTextRefusal, draftPrice, seedWorkHolds, type SeedDraft } from '../lib/seeds/plant'
import { MineCancelled } from '../lib/avatarWorker'
import { cancelMining, isMining, plantedTemplate, seedDraftName } from './plantSeed'
import { dnaResolver } from '../lib/seeds/seedSources'
import { seedItemOf } from '../lib/seeds/seedItem'
import { SEALED_KIND, freshSealedD, isSealedRef, refOf, rememberSealed, utf8Bytes, retractSealed, sealedChanges, sealedEventOf, sealedItemOf, sealedRefParts, sealedTemplate, sendBagWithSealed, type OutgoingSealed } from '../lib/sealed'
import { retractionTemplate } from '../lib/published'
import { audioInnerTemplate, fadeAt, type AudioItem } from '../lib/audioItem'
import { resealCopy } from '../lib/audioFile'
import { movableIntoRoom, openWithSecret, openWithSigner, openerFor, placeOf as eventPlace, plaintextWithSecret, readContents, resealWithout, revealedIn, sealEntries, sealedInside, sealerOf, type ChestEntry, type OpeningKey } from '../lib/chests'
import { openedByHand, restoreOpened } from './useOpenedChests'
import { closeArriving, closedByMe, closedDoorIds } from './closedDoors'
import { hiderKeys, madeKeys, openingKeys, placeOf, type HeldItem, type HeldPlace, type InChest } from '../lib/inventory'
import { lookupLock, startKeyring } from './useKeyring'
import { useInventory } from './useInventory'
import { useShardFolders } from './useShardFolders'
import { creditOf, useWorkshop } from './useWorkshop'
import { deletionFilters, isDeleted, type Credit, type FeedObject } from 'sno-core/feed'
import { bagSizeRefusal, signedBytes } from '../lib/bagSize'
import { bagBytes, growthRefusal, heldBy, planFit, referenceFor, sealFor, withReferences, type FitCandidate } from '../lib/bagFit'
import { ROOM_BAG_SETTINGS, inRoom, innermostRoomAt, newDoorSecret, roomDoorAt, roomEntries, roomKey, roomLookupId, roomOf, type OwnDoor } from '../lib/doors'
import { commitDoorSecret, doorSecret, keepDoorSecret } from './doorSecrets'
import { entriesIn, isListed, noteStored, onHiddenChange, reloadLocalView, saveRows, UNCLAIMED } from './hiddenStorage'
import { builtInLook, builtInLookTags, doorHeightOf, isDoor, keptInChest, lookOf, lookTags, lookTagsOf, posedLook, posedWrapper, wireLook, wireOpenLook, type LookName, type LookPose } from '../lib/looks'
import { useCeremony } from './useCeremony'
import { useToast } from './useToast'
import type { ShardModel } from 'sno-core/shards'
import type { Plane } from 'cyberspace-core'
import { deployPoint, type Position } from '../lib/space'
import { buildCursorOf, buildPlane, buildStepOf } from '../lib/buildCursor'
import type { NearbyReturn } from '../lib/nearbyReturn'
import { turnShard, type Turns } from '../lib/turn'
import { alignedBase, hintFits } from '../lib/hint'
import { hidesThing, type Muted } from '../lib/muteList'
import { useMutes } from './useMutes'
import { CONSTRAIN_DEFAULT, authoredConstrain, authoredConstrainOf, withConstrain, type Constrain } from '../lib/walkConstrain'

/** A workshop model's WALK setting as it publishes, by id; the default for one that never chose or is not there (DECK-0003 §1.12). */
function constrainOfId(shardId: string): Constrain {
  const m = useWorkshop.getState().shards.find((s) => s.id === shardId)
  return m ? authoredConstrainOf(m) : CONSTRAIN_DEFAULT
}

/** The WALK setting a signed shard carries in its payload as it publishes; the default when it carries none or cannot be read. */
function constrainOfSigned(ev: Pick<NostrEvent, 'content'>): Constrain {
  try { return authoredConstrain((JSON.parse(ev.content) as { constrain?: unknown }).constrain) } catch { return CONSTRAIN_DEFAULT }
}

/** One item this device hid. Its identity is its inner event id. */
export interface MyDeployment {
  /** The item's stable identity: its signed inner event id. */
  eventId: string
  /**
   * The inner event, so the region bag can be rebuilt from here: signed, or
   * for a message a rumor with no `sig` (lib/hidden.ts rumorOf). For a shard
   * hidden by reference it is the signed kind 33331 object, which is what
   * `broadcast` republishes beside the bag.
   */
  inner: Rumor
  /** Set when the item is hidden by reference: the entry the bag carries instead of `inner` (spec §7.6). */
  ref?: Reference
  /**
   * Set when the item stands in a sealed entry (kind 33335, spec §7.6 Sealed
   * entries): the `a` reference its bag carries instead of `inner`, and the
   * signed sealed entry, kept so BROADCAST can put it out again and a rewrite
   * that stops naming it can retract it. `inner` is still the item itself,
   * with its own id, lineage and place: everything about the row is as if it
   * stood inline, except where its bag stores it. Never with `ref`.
   */
  sealedRef?: Reference
  sealedEvent?: NostrEvent
  /**
   * The lineage of an inline shard that went by reference because its bag
   * could not hold it inline (lib/bagFit.ts): the first version's id its
   * comments and reactions name (lib/hidden.ts itemLineage). The object has
   * an address of its own, which comments made from now name; this keeps the
   * earlier ones under it too (owner ruling, 2026-10-16: comments survive
   * EDIT). Only on this device's row: the reference says nothing of it.
   */
  lineage?: string
  /** The envelope currently holding it; changes when the bag is rewritten. */
  bagId: string
  /**
   * The created_at of the version of its bag that last held it, as written
   * here or read from the relays: only a newer version that no longer holds
   * it says it is gone (pruneGoneRows). The bag clock runs ahead of the wall
   * clock after quick hides (nextBagAt), so `createdAt` cannot say this.
   * Absent on rows from before it was kept: such a row is never marked gone.
   */
  bagAt?: number
  /**
   * GONE FROM ITS BAG: a version of its bag newer than the one that last held
   * it (this created_at) no longer holds it. Moved or removed from another
   * device, or dropped by another device's stale rewrite: the two cannot be
   * told apart, so it is kept, never written back into its bag (where a stale
   * device would bring a moved copy back), and its owner chooses: HIDE AGAIN
   * or FORGET (arkinox's ruling, review 3 of #595). A later version that
   * holds it again clears it. Never on a door, which goes as it always did.
   */
  goneFrom?: number
  type: HiddenType
  shard?: ShardModel
  text?: string
  key?: KeyItem
  chest?: ChestItem
  audio?: AudioItem
  at: { x: string; y: string; z: string }
  plane: Plane
  height: number
  lookupId: string
  keyHex: string
  relays: string[]
  createdAt: number
  published: boolean
  /**
   * The settings of the bag this item is in, as last written from here or
   * read from the relay: the same for every item in the region. Absent on a
   * deployment saved before bags had settings, which is DEFAULT_BAG_SETTINGS,
   * exactly what those bags carried.
   */
  bag?: BagSettings
  /**
   * A reference shard whose failed EDIT could not be put back: the old object
   * signed again, which the relays must take before the old place opens again.
   * Published first by the next EDIT, DELETE or BROADCAST of this row
   * (review of #369).
   */
  putBack?: NostrEvent
  /**
   * For a chest: what it holds, as sealed (signed events and rumors), kept
   * on the device that sealed it, so EDIT and ADD can seal it again without
   * the key it is locked to. Never published. Absent on a chest from before,
   * or claimed from another device: EDIT and ADD then open it first.
   */
  sealed?: BagEntry[]
  /**
   * Set when it is hidden in a room (DECK-0004 §3.7.4): the door whose room
   * it stands in. `lookupId` and `keyHex` are then the room bag's and the room
   * key, `height` the room's, and `bag` ROOM_BAG_SETTINGS.
   */
  room?: { doorId: string }
  /**
   * A door of a rotation (§3.7.7) that no relay took: what the rotation still owes.
   * The rooms to retract, which stay until every door has left them, and the door
   * this one replaced, which must not go back in a bag beside it. EDIT rotates again.
   */
  rotating?: Array<{ lookupId: string; bagId: string | null; doorId: string }>
}

/** Something placed in the world, ready to draw. */
export interface WorldItem {
  key: string
  type: HiddenType
  at: Position
  plane: Plane
  height: number
  mine: boolean
  author?: string
  shard?: ShardModel
  text?: string
  /** The key item, for a key (`key` above is the world item's own id). */
  keyItem?: KeyItem
  chest?: ChestItem
  /** Hidden audio (DECK-0007): its file, key and how it is heard. */
  audio?: AudioItem
  createdAt?: number
  /** The bag's lookup id, for anything addressed to the bag (comments). */
  lookupId?: string
  /** The bag's event id, for the inventory's record of where a thing was found. */
  bagId?: string
  /** The key that opened its bag, which seals its comments: the region key, or in a room the room key (lib/comments CommentSubject). */
  bagKeyHex?: string
  /** For an item hidden by reference: the event comments answer (lib/comments ItemTarget). */
  target?: ItemTarget
  /**
   * What comments and reactions name an inline item by: its first version's
   * id, which EDIT carries forward (lib/hidden.ts itemLineage). Absent for an
   * item hidden by reference, whose object's address does that.
   */
  lineage?: string
  /** The chest this was revealed from, when it came out of one: its hider takes it out with removeFromChest, not DELETE. */
  chestId?: string
  /**
   * The event itself: the inner item, or for a LIVE LINK the public object
   * (the modal's event data). A message's is a rumor with no `sig`, and the
   * event data shows none (EventData eventJson).
   */
  event?: NostrEvent
}

/**
 * Whether the mute list hides a thing in the world: by the bag's signer, the
 * object a LIVE LINK places, or the author a chest's entry claims, or by its
 * own id or the lineage a moved item keeps. Never one of yours.
 */
export function worldItemHidden(w: Pick<WorldItem, 'mine' | 'author' | 'event' | 'target' | 'key' | 'lineage'>, muted: Muted, me: string): boolean {
  return hidesThing(muted, muteSubject(w), me)
}

/** What the mute list is asked about a world item: who holds and made it, and every id it goes by. Kept with its sound, so a mute stops it (useHiddenAudio). */
export function muteSubject(w: Pick<WorldItem, 'mine' | 'author' | 'event' | 'target' | 'key' | 'lineage'>): { authors: (string | undefined)[]; ids: (string | undefined)[]; mine: boolean } {
  return { authors: [w.author, w.event?.pubkey, w.target?.pubkey], ids: [w.key, w.lineage, w.event?.id], mine: w.mine }
}

/** The same for a find as the scan keeps it (`discovered`), for the lists that read those directly. */
export function findHidden(h: Pick<Hidden, 'author' | 'inner' | 'ref' | 'eventId'>, muted: Muted, me: string): boolean {
  return hidesThing(muted, { authors: [h.author, h.inner?.pubkey], ids: [h.eventId, lineageOf(h.inner, h.ref).lineage, h.inner?.id] }, me)
}

/** Why a LIVE LINK was not hidden: its author protected it (NIP-70), so only they may republish it. */
export const LINK_PROTECTED = 'Protected by its author: it can only be placed as a copy.'
/** Why a LIVE LINK was not hidden: its author deleted it (NIP-09). */
export const LINK_DELETED = 'Its author deleted this object.'

/** An event its author protected (NIP-70, the `-` tag): only they may republish it. */
export function isProtected(o: { event: { tags: string[][] } }): boolean {
  return o.event.tags.some((t) => t[0] === '-')
}

/** Whether the object's author deleted it, as the relays you use answer (NIP-09; one tag filter per read). */
async function authorDeleted(o: { pubkey: string; address: string; id: string; createdAt: number }): Promise<boolean> {
  try {
    const found = (await Promise.all(deletionFilters([o]).map((f) => query({ ...f })))).flat()
    return isDeleted(o, found)
  } catch {
    return false
  }
}

/**
 * Put a signed event on your relays, each on its own, and answer with the
 * first that took it, as soon as one does: a silent relay is not waited on.
 * Null when none takes it.
 */
function republish(event: NostrEvent): Promise<string | null> {
  const urls = relaySet()
  if (urls.length === 0) return Promise.resolve(null)
  return new Promise((resolve) => {
    let left = urls.length
    let done = false
    for (const url of urls) {
      void publishMany([url], event).then((r) => r.ok, () => false).then((ok) => {
        left -= 1
        if (ok && !done) { done = true; resolve(url) } else if (left === 0 && !done) resolve(null)
      })
    }
  })
}

/**
 * Copy on pick (arkinox's ruling, 2026-10-08): the author's object is put on
 * your relays the moment LIVE LINK is picked, not when the bag goes out, so
 * the object and the bag do not reach a watching relay seconds apart and
 * pair the object with the bag. One background copy per event, remembered:
 * the deploy takes its relay as the hint and does not copy again. Only while
 * LIVE: LOCAL sends nothing, and BROADCAST copies with the bag as before.
 */
interface LinkCopy { hint: string | null; deleted: boolean }
const linkCopies = new Map<string, Promise<LinkCopy>>()

/** The background copy of a LIVE LINK object to your relays: refused if its author deleted it, else the first relay that took it. */
function copyForLink(o: FeedObject): Promise<LinkCopy> {
  const held = linkCopies.get(o.id)
  if (held) return held
  const copy = (async (): Promise<LinkCopy> => {
    if (await authorDeleted(o)) return { hint: null, deleted: true }
    return { hint: await republish(o.event as NostrEvent), deleted: false }
  })()
  linkCopies.set(o.id, copy)
  // A copy that no relay took is not remembered: the deploy tries again.
  void copy.then((c) => { if (!c.hint && !c.deleted && linkCopies.get(o.id) === copy) linkCopies.delete(o.id) })
  return copy
}

/** Forget the remembered copies (for tests). */
export function forgetLinkCopies(): void {
  linkCopies.clear()
}

/** Why a LIVE LINK was not hidden: the author's object could not be put where finders look. */
export const LINK_REFUSED = "LIVE LINK needs the author's object on one of your relays, and none took it. Place it as a copy instead."

/**
 * A shard aimed from the chest composer (arkinox, 2026-10-10: "When I hid a
 * shard in the chest I never got to position it"): its inner event, signed
 * through the deploy bar at the place, size and pose it should have when the
 * chest opens, and the unit it went out at, for the composer's row. The seal
 * takes the event as it is instead of signing the model at the chest.
 */
export interface AimedShard {
  signed: NostrEvent
  unit: number
}

/** What the composer puts in a chest: signed at COMMIT, then sealed (B1 §3.1). */
export type ChestContent =
  | { kind: 'message'; text: string }
  /** One of your workshop models, carried inline; aimed, it is already signed where it should stand. */
  | { kind: 'shard'; shardId: string; aimed?: AimedShard }
  /**
   * An item (a keypair): one forged here with the full forge (FORGE NEW), or
   * with `copy`, one from your ITEMS that you made (FROM MY ITEMS; arkinox,
   * 2026-11-09: "id like to customize the items I place"). A copy is the
   * same key, sealed as PLACE from ITEMS places it (copyTemplateAt): its
   * keypair, secret and every tag. Neither is held until it is taken out
   * (arkinox, 2026-11-06).
   */
  | { kind: 'key'; key: KeyItem; copy?: NostrEvent }
  /** Hidden audio, its file already encrypted and uploaded (AudioCompose): sealed in at the chest's place. */
  | { kind: 'audio'; audio: AudioItem }
  /**
   * Something already sealed in a chest of yours, kept as it is when EDIT or
   * ADD seals the chest again (its event, signed or a rumor, untouched), with
   * the words its row shows.
   */
  | { kind: 'sealed'; entry: BagEntry; label: string; type: HiddenType }

/** What a chest is sealed to, and how the composer named it. */
export interface ChestLock {
  pubkey: string
  /** For the bar and the ghost: the key's name, or "a person". */
  label: string
  /** A region's or a room's lock (DECK-0004 §3.8), not an item's or a person's; absent for those. */
  kind?: 'region' | 'room'
  /** How REGION picked it, so the composer comes back to the same choice. */
  region?: RegionChoice
  /** Which room key ROOM picked: its room bag's `d`. */
  room?: { lookupId: string }
}

/** A region lock as the LOCK block picked it: around the chest, around you, or a key from your keyring, and its height. */
export interface RegionChoice {
  from: 'chest' | 'me' | 'keyring'
  height: number
  lookupId?: string
}

/**
 * A chest as the composer hands it over, before anything is sealed. The lock
 * is null only while drafting: a shard can be aimed before the lock is
 * chosen, and the composer comes back to the draft as it was. PLACE CHEST
 * needs the lock (startDeployChest).
 */
export interface ChestDraft {
  name: string
  lock: ChestLock | null
  requires: string
  contents: ChestContent[]
}

/**
 * The model a chest or a door wears, chosen on the hide bar's model row
 * (chest and door design, D2, D3): a built-in, one of your workshop models
 * carried inline as a copy (MINE), or an object from the Shard Feed placed
 * by a one-part wrapper that follows its author's edits (FEED; DECK-0004
 * §3.6, "a look whose only content is one part placing it").
 */
export type LookChoice =
  | { from: 'builtin'; name: LookName }
  | { from: 'mine'; shardId: string }
  | { from: 'feed'; object: FeedObject }
  /** The look a hidden chest already wears, kept by MOVE: posed again from where it stands. */
  | { from: 'model'; closed: ShardModel; open: ShardModel | null }
  /** A look this client will not read (over MAX_LOOK_BYTES, or failing the format), kept by MOVE exactly as it is, never swapped for a built-in. */
  | { from: 'kept'; tags: string[][] }

/** What a chest wears when nothing else is chosen. */
export const DEFAULT_CHEST_LOOK: LookChoice = { from: 'builtin', name: 'treasure' }
/** What a door wears when nothing else is chosen (D2). */
export const DEFAULT_DOOR_LOOK: LookChoice = { from: 'builtin', name: 'door' }

/**
 * A feed object as a look: a model with no geometry of its own and one part
 * placing the object by its address at its origin, so it can be turned and
 * scaled and still follows its author's edits (§3.6). Scaled by the part's
 * step, since a placed object is drawn at its own unit plus the step
 * (DECK-0003 §1.10).
 */
export function feedWrapper(object: FeedObject, unit: number = object.shard.unit): ShardModel {
  const relay = object.seen?.[0]
  return {
    id: `look:${object.address}`, name: object.shard.name, unit, extent: object.shard.extent, mode: 'solid',
    vertices: [], faces: [], up: false, spin: 0, updatedAt: 0,
    refs: [relay ? ['a', object.address, relay] : ['a', object.address]],
    parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: unit - object.shard.unit }],
  }
}

/** The closed model a choice wears, unposed: what the ghost shows and SCALE starts from. Null when a MINE model is gone. */
export function lookModelOf(choice: LookChoice): ShardModel | null {
  if (choice.from === 'builtin') return builtInLook(choice.name).closed
  if (choice.from === 'feed') return feedWrapper(choice.object)
  if (choice.from === 'model') return choice.closed
  if (choice.from === 'kept') return null
  return useWorkshop.getState().shards.find((s) => s.id === choice.shardId) ?? null
}

/**
 * A choice as its `look` tags, posed by the hide bar: a built-in closed and
 * open, a MINE model or a FEED wrapper closed alone (§3.6: with no open look
 * an opened chest keeps its closed look, an opened door is not drawn).
 * Throws with lib/looks.ts lookRefusal's words when a look is too large, and
 * when a MINE model is no longer in the workshop.
 */
export function lookTagsFor(choice: LookChoice, pose: LookPose): string[][] {
  if (choice.from === 'builtin') return builtInLookTags(choice.name, pose)
  if (choice.from === 'feed') return lookTags(posedWrapper(feedWrapper(choice.object, pose.unit), pose), null)
  if (choice.from === 'kept') return choice.tags.map((t) => [...t])
  if (choice.from === 'model') return lookTags(wireLook(choice.closed, pose), choice.open ? wireOpenLook(choice.open, pose) : null)
  const model = useWorkshop.getState().shards.find((s) => s.id === choice.shardId)
  if (!model) throw new Error('That model is no longer in your workshop.')
  return lookTags(posedLook(model, pose), null)
}

/** Whether any shard in the draft has been aimed: the chest's height then follows them (DeployBar). */
export function hasAimed(draft: Pick<ChestDraft, 'contents'>): boolean {
  return draft.contents.some((c) => c.kind === 'shard' && !!c.aimed)
}

/** The aimed shards of a draft, by their index in the contents. */
export function aimedOf(draft: Pick<ChestDraft, 'contents'>): Array<{ index: number; aimed: AimedShard }> {
  const out: Array<{ index: number; aimed: AimedShard }> = []
  draft.contents.forEach((c, index) => { if (c.kind === 'shard' && c.aimed) out.push({ index, aimed: c.aimed }) })
  return out
}

/** What a deploy is placing, before it lands. */
export type DeployPending =
  /**
   * One of your models (`shardId`), or an object from the Shard Feed
   * (`object`, with `shardId` its address). From the feed it goes out as a
   * credited copy, or with LIVE LINK by reference to the author's object.
   * With `intoChest` it is a model aimed from the chest composer: the deploy
   * signs it where it stands and hands the chest back with it inside, and
   * hides nothing (no key, no bag, no relay). The chest rides along so CANCEL
   * and BUILD mode ending both have it to give back.
   *
   * With `edit` it is a shard already hidden from here (`eventId`, among
   * `mine`), being moved: the deploy hides it at the cursor and takes the old
   * one out of its bag, and the new one keeps the old one's identity
   * (lib/hidden.ts itemLineage), so its comments and reactions stay with it
   * (arkinox, 2026-10-16). `shardId` is then that event id.
   *
   * `from` 'workshop': DEPLOY on the bench started it, and CANCEL goes back
   * to the bench (arkinox, 2026-10-16), not to BUILD mode.
   */
  | { type: 'shard'; shardId: string; object?: FeedObject; intoChest?: { draft: ChestDraft; contentIndex: number }; edit?: { eventId: string }; from?: 'workshop' }
  /**
   * With `move` (here and on a key and hidden audio) it is one already
   * hidden from here (`eventId`, among `mine`), being moved (MOVE on its
   * card or its DEPLOYED row): the same item at a new place, every tag and
   * its content as they were, carrying its first version's id as `d`
   * (lib/hidden.ts movedTemplate), so its reactions, mutes, once-triggers
   * and notifications follow it as an EDIT's do.
   */
  | { type: 'message'; text: string; move?: { eventId: string }; copy?: NostrEvent }
  /**
   * A key forged in the composer: the keypair is made there, so its public key can be shown and sealed to before it is hidden.
   *
   * With `copy` (here and on a message) it is PLACE on an ITEMS row of your
   * own make (arkinox, 2026-11-06: "place the same item again easily once its
   * in my inventory ... just a new instance"): a new instance of that event at
   * the build cursor, its kind, content and every tag as they were, newer,
   * with no lineage (copyTemplateAt). A key's copy is the same key: its
   * keypair and secret, as HIDE AGAIN's is.
   */
  | { type: 'key'; key: KeyItem; move?: { eventId: string }; copy?: NostrEvent }
  /**
   * A chest (chest and door design, R18: "placed first, then filled with
   * ADD"). `look`: what it wears (the hide bar's model row); absent, the
   * built-in TREASURE. SEAL A CHEST lines it up empty on the hide bar; PLACE
   * CHEST fixes where it lands (`spot`) and the chest modal fills it, then
   * seals and hides it there. With `move` it is a chest already hidden from
   * here, being moved (MOVE on its card): the same sealed chest, at a new
   * place, wearing its look posed again.
   *
   * With `door` it is a door (chest and door design, 4.2): placed the same
   * way, and sealed around one secret for its room rather than contents.
   */
  | ({ type: 'chest'; look?: LookChoice; spot?: { at: Position; plane: Plane }; move?: { eventId: string }; door?: true } & ChestDraft)
  /**
   * Hidden audio (DECK-0007): the file is encrypted and on Blossom already
   * (AudioCompose); the item is sealed as a rumor. With `reseal` it is PLACE
   * AGAIN's copy: the deploy seals the file again under a fresh key and
   * uploads it before it hides the item, so no two placements share a key.
   * `server` is the Blossom server the hider picked for the first upload,
   * where a copy goes too: a server may answer with a URL on another host.
   */
  | { type: 'audio'; audio: AudioItem; reseal?: true; server?: string; move?: { eventId: string } }
  /**
   * A seed (DECK-0008): one planting of a DNA at the build cursor. Its work
   * is mined at COMMIT, once its place, its time and its planted block are
   * fixed (lib/seeds/plant.ts), and its DNA goes to the relays first when it
   * is not there yet (free). `dna` is the signed DNA once there is one.
   */
  | { type: 'seed'; seed: SeedDraft }

/**
 * Whether a deployment can be moved with EDIT: a shard of yours, inline or
 * hidden by reference as your own sealed object. A LIVE LINK names someone's
 * public object, which is not yours to reseal, and a key, a message or a chest
 * is not a shard.
 */
export function editable(d: Pick<MyDeployment, 'type' | 'shard' | 'ref' | 'inner'>, me: string): boolean {
  if (d.type !== 'shard' || !d.shard || d.inner.pubkey !== me) return false
  if (!d.ref) return true
  return d.inner.kind === OBJECT_KIND && d.inner.tags.some((t) => t[0] === 'encrypted') && dOf(d.inner) !== ''
}

/**
 * Whether MOVE can take a deployment of yours somewhere else (arkinox,
 * 2026-11-02: "need to be able to move placed items"): a shard by EDIT
 * (editable), a chest or a door by its own MOVE (a door only where this
 * device knows its secret, as its other actions need), and a key item, a
 * message or hidden audio carried inline and written by you. Something
 * revealed from a chest is part of that chest, not a bag entry, and never
 * has a row of its own here.
 */
export function movable(d: Pick<MyDeployment, 'type' | 'shard' | 'ref' | 'inner' | 'chest' | 'eventId' | 'key' | 'text' | 'audio' | 'goneFrom'>, me: string): boolean {
  if (!me || d.inner?.pubkey !== me || d.goneFrom !== undefined) return false
  if (d.type === 'shard') return editable(d, me)
  if (d.type === 'chest') return !!d.chest && (d.chest.door === undefined || !!doorSecret(me, d.eventId))
  if (d.ref) return false
  return d.type === 'key' ? !!d.key : d.type === 'message' ? d.text !== undefined : d.type === 'audio' ? !!d.audio : false
}

/** The deployment a pending MOVE of a key item, a message or hidden audio is moving, or null. */
export function itemMovingId(pending: DeployPending | null): string | null {
  return pending && (pending.type === 'key' || pending.type === 'message' || pending.type === 'audio') ? pending.move?.eventId ?? null : null
}

/**
 * Your shards a deploy placed, by the ref the lists file them under (hud
 * ShardFolders): a model, the models in a chest, or your own object from the
 * feed. A deploy that went through moves them to the top of every list of
 * your shards, inside their folders, as an edit does (arkinox, 2026-10-23).
 * An aim into a chest places nothing until the chest is hidden, and a move
 * (EDIT) is of a deployment, not of a model.
 */
export function deployedRefs(pending: DeployPending, me: string): string[] {
  if (pending.type === 'chest') return pending.contents.flatMap((c) => (c.kind === 'shard' ? [c.shardId] : []))
  if (pending.type !== 'shard' || pending.intoChest || pending.edit) return []
  if (pending.object) return pending.object.pubkey === me ? [pending.object.d] : []
  return [pending.shardId]
}

/** The event id of the deployment a pending EDIT is moving, or null. */
export function editingId(pending: DeployPending | null): string | null {
  return pending?.type === 'shard' ? pending.edit?.eventId ?? null : null
}

/** The deployment a pending deploy moves: a shard's EDIT, or a chest's MOVE. */
export function movingId(pending: DeployPending | null): string | null {
  return editingId(pending) ?? itemMovingId(pending) ?? (pending?.type === 'chest' ? pending.move?.eventId ?? null : null)
}

/** Whether a chest is still being placed on the hide bar: SEAL A CHEST's first step, before PLACE CHEST (R18). */
export function placingChest(pending: DeployPending | null): boolean {
  return pending?.type === 'chest' && !pending.spot && !pending.move
}

/** Whether a placed chest is being filled in its modal: the hide bar steps aside for it. */
export function fillingChest(pending: DeployPending | null): boolean {
  return pending?.type === 'chest' && !!pending.spot && !pending.move
}

/** Your doors as a placement asks about them: every door row signed by you, with its secret when this device knows it. */
export function ownDoors(mine: readonly MyDeployment[], me: string): OwnDoor[] {
  return mine.flatMap((d) => (d.type === 'chest' && d.chest?.door !== undefined && d.inner.pubkey === me
    ? [{ eventId: d.eventId, name: d.chest.name, at: positionOf(d), plane: d.plane, height: d.chest.door, secret: doorSecret(me, d.eventId) }]
    : []))
}

/** What refuses CONVERT TO DOOR, short enough for the card: how many things could not stand in the room. */
export function cantMove(n: number): string {
  return `${n} CAN'T MOVE`
}

/** A door's own height: what the ROOM HEIGHT row chose, never above the height it is hidden at; the hidden height until then. */
export function effectiveDoorHeight(chosen: number | null, hideHeight: number): number {
  return chosen === null ? hideHeight : Math.min(chosen, hideHeight)
}

/**
 * How deep a door is (R6, §3.7.6): 1 at the top level, one more for each room
 * it stands in. What its red cube's line count says.
 */
export function doorDepth(mine: readonly MyDeployment[], door: Pick<MyDeployment, 'eventId' | 'room'>): number {
  let depth = 1
  const seen = new Set([door.eventId])
  let at = door.room?.doorId
  while (at && !seen.has(at)) {
    seen.add(at)
    depth++
    at = mine.find((m) => m.eventId === at)?.room?.doorId
  }
  return depth
}

/** What stands behind a door of yours: the rows of its room, whichever of its doors they name. */
export function behindDoor(mine: readonly MyDeployment[], door: MyDeployment): MyDeployment[] {
  const ids = new Set([door.eventId, ...doorsBeside(mine, door).map((d) => d.eventId)])
  return mine.filter((m) => !!m.room && ids.has(m.room.doorId))
}

/** Everything behind a door, what stands behind the doors behind it included: what DELETE's count says (R12). */
export function behindDoorDeep(mine: readonly MyDeployment[], door: MyDeployment): MyDeployment[] {
  const out: MyDeployment[] = []
  const seen = new Set<string>([door.eventId])
  const walk = (d: MyDeployment): void => {
    for (const r of behindDoor(mine, d)) {
      if (seen.has(r.eventId)) continue
      seen.add(r.eventId)
      out.push(r)
      if (r.chest?.door !== undefined) walk(r)
    }
  }
  walk(door)
  return out
}

/** The other doors of your room (§3.7.5): the same signer, height and region. */
export function doorsBeside(mine: readonly MyDeployment[], door: MyDeployment): MyDeployment[] {
  const h = door.chest?.door
  if (h === undefined) return []
  const room = roomOf(positionOf(door), door.plane, h)
  return mine.filter((m) => m.eventId !== door.eventId && m.chest?.door === h && m.inner.pubkey === door.inner.pubkey && roomOf(positionOf(m), m.plane, h) === room)
}

/**
 * What you already hid in a door's room and did not seal behind it (R3), at
 * any height (arkinox, 2026-11-09: the list was "missing a lot of shards"; it
 * kept only what stood at the room's own height). Every placement of yours
 * whose point is inside the room's cube, in its plane: an ordinary one, or one
 * in a room this door stands in (the room around it), which SEAL moves one room
 * deeper. Never a door, never what is behind another door here.
 */
export function hereInRoom(mine: readonly MyDeployment[], door: MyDeployment): MyDeployment[] {
  const h = door.chest?.door
  if (h === undefined) return []
  const at = positionOf(door)
  // The rooms around this door, by every door each has (§3.7.5: a room of two doors files its rows under either).
  const around = new Set<string>()
  for (let id = door.room?.doorId; id && !around.has(id);) {
    const outer = mine.find((m) => m.eventId === id)
    around.add(id)
    if (!outer) break
    for (const d of doorsBeside(mine, outer)) around.add(d.eventId)
    id = outer.room?.doorId
  }
  // Never a row gone from its bag, or one whose old version waits to go back: neither stands where the row says.
  return mine.filter((m) => (!m.room || around.has(m.room.doorId)) && inItsBag(m) && !m.putBack && m.eventId !== door.eventId && m.chest?.door === undefined && m.plane === door.plane && inRoom(at, h, positionOf(m)))
}

/** The height the hide bar's HIDE AT HEIGHT was set to: the one a room's height stands in for while the placement joins that room. */
export function chosenHeight(s: Pick<ShardsState, 'deployHeight' | 'deployRoomSnap'>): number {
  return s.deployRoomSnap?.chosen ?? s.deployHeight
}

/**
 * The height of the room of a door being placed. Joining a room of yours, it
 * is what ROOM HEIGHT set, or else the height that was chosen to hide it at,
 * never the room's own (that would make it a second door of that room, R5).
 * Otherwise effectiveDoorHeight, as it always was.
 */
export function placedDoorHeight(s: Pick<ShardsState, 'deployHeight' | 'deployDoorHeight' | 'deployRoomSnap'>): number {
  return s.deployRoomSnap ? Math.min(s.deployDoorHeight ?? s.deployRoomSnap.chosen, s.deployHeight) : effectiveDoorHeight(s.deployDoorHeight, s.deployHeight)
}

/**
 * The rooms of yours this identity has CLOSEd, as roomOf says them: a door of
 * the room closed here (under the lock it has now), or the room standing behind
 * a closed door (closedRoomTest). Nothing joins one of these on its own.
 */
export function closedRooms(mine: readonly MyDeployment[], me: string): Set<string> {
  const out = new Set<string>()
  if (closedDoorIds(me).size === 0) return out
  const shut = closedRoomTest({ mine: [...mine], discovered: {} }, me)
  if (!shut) return out
  for (const d of mine) {
    const h = d.chest?.door
    if (h === undefined || d.inner.pubkey !== me) continue
    if (closedByMe(me, d.eventId, d.chest?.lockPubkey) || shut(d.eventId)) out.add(roomOf(positionOf(d), d.plane, h))
  }
  return out
}

/**
 * The room of yours a placement joins on its own, whatever height was chosen
 * (arkinox, 2026-11-09): the innermost whose cube holds the point and not left
 * out with the X. Every new placement of every kind; never an aim into a chest.
 * A MOVE or EDIT of something already placed keeps its own bag and height
 * unless SEAL IN ROOM asked (`deploySealMove`, review of #633); a door being
 * moved never, since it stays in its own room at its own height (R7). A room
 * you CLOSEd never takes anything on its own (review of #633). A door being
 * placed joins only a room higher than its own (§3.7.6 MUST); in any other it
 * is left out, at the chosen height, where one of the room's height is a
 * second door of that room (R5).
 */
export function autoRoomFor(s: Pick<ShardsState, 'mine' | 'pending' | 'deployLeaveOut' | 'deployDoorHeight' | 'deployHeight' | 'deployRoomSnap' | 'deploySealMove'>, me: string, at: Position, plane: number): OwnDoor | null {
  const p = s.pending
  if (!p || (p.type === 'shard' && p.intoChest)) return null
  if (p.type === 'chest' && p.move && s.mine.find((d) => d.eventId === p.move?.eventId)?.chest?.door !== undefined) return null
  if (movingId(p) !== null && !s.deploySealMove) return null
  const own = p.type === 'chest' && p.door && !p.move ? s.deployDoorHeight ?? chosenHeight(s) : null
  const left = new Set(s.deployLeaveOut)
  const closed = closedRooms(s.mine, me)
  return innermostRoomAt(ownDoors(s.mine, me), at, plane, (d) => {
    const room = roomOf(d.at, d.plane, d.height)
    return !left.has(room) && !closed.has(room) && (own === null || own < d.height)
  })
}

/**
 * The door a placement seals to, or null (chest and door design, R1, R2,
 * 4.3): yours, its room holding the point, hidden at exactly its height, and
 * not left out with the X. A door at the same height in the same room joins
 * the room rather than entering it (R5). An aim into a chest hides nothing.
 * The height is the room's whenever the point is in one (autoRoomFor).
 */
export function sealingDoor(s: Pick<ShardsState, 'mine' | 'pending' | 'deployLeaveOut' | 'deployDoorHeight'> & Partial<Pick<ShardsState, 'deployRoomSnap' | 'deploySealMove'>>, me: string, at: Position, plane: number, height: number): OwnDoor | null {
  const p = s.pending
  if (!p || (p.type === 'shard' && p.intoChest)) return null
  if (p.type === 'chest' && p.move) {
    // A door moves only inside its own room (R7), so it stays in the bag that
    // holds it: the outer room when it is nested, an ordinary bag when not.
    const moved = s.mine.find((d) => d.eventId === p.move?.eventId)
    if (moved?.chest?.door !== undefined) return moved.room ? ownDoors(s.mine, me).find((d) => d.eventId === moved.room?.doorId) ?? null : null
  }
  // A door of the room's own height joins that room (R5); a lower one goes
  // into it like anything else (R6, §3.7.6), its own room a smaller cube inside.
  if (p.type === 'chest' && p.door && !p.move && placedDoorHeight({ deployHeight: height, deployDoorHeight: s.deployDoorHeight, deployRoomSnap: s.deployRoomSnap ?? null }) === height) return null
  const d = roomDoorAt(ownDoors(s.mine, me), at, plane, height)
  if (!d || s.deployLeaveOut.includes(roomOf(d.at, d.plane, d.height))) return null
  // A MOVE or EDIT keeps its own bag (review of #633): the room it already stands in, or none, unless SEAL IN ROOM.
  const moving = movingId(p)
  if (moving !== null && !s.deploySealMove) {
    const was = s.mine.find((m) => m.eventId === moving)?.room?.doorId
    const door = s.mine.find((m) => m.eventId === d.eventId)
    return was && door && (was === door.eventId || doorsBeside(s.mine, door).some((b) => b.eventId === was)) ? d : null
  }
  return d
}

/**
 * Whether a placement of this lines the same thing up again (arkinox,
 * 2026-10-23: "after I place something, I'd actually like build to default
 * to that same object so I can place another one"). Each type says so here,
 * and a new type must too: the switch is exhaustive, so the compiler asks.
 *
 * - A shard repeats: a model, or a feed object as a copy or a LIVE LINK.
 *   What must be unique per placement is made fresh by every deploy (its
 *   signature and created_at, a large shard's object address, the region
 *   key and bag).
 * - A move (EDIT) does not: it moves one deployment, which then stands
 *   where it was put. Nor does an aim into a chest: it signs into the chest,
 *   which goes back to its composer.
 * - A message repeats, unless a cashu token is written in it: a bearer token
 *   hidden twice is the same money in two places, and only one finder
 *   could ever redeem it.
 * - A key does not: the item is its keypair, made once in the composer, and
 *   a second copy would hide the same secret twice, opening the same chests.
 * - A chest does not: its contents are signed and sealed once, and may hold
 *   keys forged inside, shards aimed at their own points, or cashu.
 * - Hidden audio repeats, each copy under its own key: againOf marks it
 *   `reseal`, and the deploy encrypts the file again with a fresh key and
 *   uploads that ciphertext (lib/audioFile resealCopy). A fresh item over
 *   the same key would let a finder of one placement read, by its hash and
 *   key, that another placement is the same sound.
 */
export function repeatable(pending: DeployPending): boolean {
  switch (pending.type) {
    case 'shard': return !pending.intoChest && !pending.edit
    // A coin or a nonfungible.cash claim link is a bearer thing: a copy would copy it (review of #615).
    case 'message': return !pending.move && findCashuToken(pending.text) === null && !hasNftLink(pending.text)
    case 'key': return false
    case 'chest': return false
    case 'audio': return !pending.move
    // Another planting of the same DNA: its own work, mined again.
    case 'seed': return true
    default: {
      const unknown: never = pending
      return unknown
    }
  }
}

/**
 * The same thing, lined up again after a placement. Only what the first
 * deploy began with is dropped: `from` 'workshop', since CANCEL on a copy
 * stands down where a placement leaves you (BUILD mode), not on the bench.
 */
function againOf(pending: DeployPending): DeployPending {
  // Its file is sealed again under a fresh key when the copy is placed (repeatable).
  if (pending.type === 'audio') return { type: 'audio', audio: pending.audio, reseal: true, ...(pending.server ? { server: pending.server } : {}) }
  if (pending.type !== 'shard') return { ...pending }
  return { type: 'shard', shardId: pending.shardId, ...(pending.object ? { object: pending.object } : {}) }
}

/**
 * Where and how a placement lands, as one string: its point, plane and
 * height, and the size, turns, pose and link it went out with. A copy whose
 * string is the last one's would land exactly on top of it, identical: a
 * second press, or Space held, rather than a placement.
 */
export function spotOf(at: Position, plane: Plane, s: Pick<DeploySettings, 'deployHeight' | 'deployUnit' | 'deployUp' | 'deploySpin' | 'deployTurn' | 'deployLink'>): string {
  return [plane, at.x, at.y, at.z, s.deployHeight, s.deployUnit, s.deployTurn.join('.'), s.deployUp ? s.deploySpin : 'flat', s.deployLink ? 'link' : 'copy'].join(':')
}

/**
 * The placement settings the deploy bar holds for the thing itself, kept
 * whole from one placement to the next. The bag controls are not among
 * them: they are the bag's, seeded from the bag under the cursor
 * (seedDeployBag), so a riddle never follows into another bag.
 */
export type DeploySettings = Pick<ShardsState, 'deployHeight' | 'deployHeightAuto' | 'deployUnit' | 'deployUp' | 'deploySpin' | 'deployTurn' | 'deployFollow' | 'deployLink'>

/** The last placement BUILD mode can line up again, with everything it went out with. */
export interface PlacedLast {
  /** What is lined up again: the very object `pending` holds while it is. */
  pending: DeployPending
  settings: DeploySettings
  /** The build STEP it was placed at (useCyberspace `buildStep`), null for the zoom. */
  step: number | null
  /** Where and how it landed (spotOf), so an identical copy on top of it is refused. */
  spot: string
  /** How many of it have been placed in a row. */
  count: number
}

/**
 * Only a copy is lined up: the last placement again (`placedLast`), not
 * hiding. It is no work of yours to lose, so leaving BUILD mode, EDIT and
 * the mode ending under it stand it down quietly rather than waiting on it
 * or keeping it as a draft.
 */
export function copyLinedUp(s: { pending: DeployPending | null; placedLast: PlacedLast | null; deployStatus: DeployStatus }): boolean {
  return s.pending !== null && s.pending === s.placedLast?.pending && s.deployStatus !== 'working'
}

/** A copy lined up on the very spot, and with the very settings, the last one went out at: placing it is refused. */
export function atLastSpot(s: Pick<ShardsState, 'pending' | 'placedLast' | 'deployHeight' | 'deployUnit' | 'deployUp' | 'deploySpin' | 'deployTurn' | 'deployLink'>, cs: ReturnType<typeof useCyberspace.getState>): boolean {
  if (s.pending === null || s.placedLast?.pending !== s.pending) return false
  const { position, plane } = buildCursorOf(cs)
  return s.placedLast.spot === spotOf(deployPoint(position, buildStepOf(cs), s.deployHeight), plane, s)
}

/** The name of what PLACE AGAIN would line up, or null when there is nothing to place again (a model since deleted). */
export function againName(s: { placedLast: PlacedLast | null }): string | null {
  const p = s.placedLast?.pending
  if (!p) return null
  if (p.type === 'message') return messagePreview(p.text)
  if (p.type !== 'shard') return pendingName(p, null)
  if (p.object) return p.object.shard.name || 'shard'
  return useWorkshop.getState().shards.find((m) => m.id === p.shardId)?.name ?? null
}

/** againName, current with the workshop too, so a model renamed or deleted since shows at once. */
export function useAgainName(): string | null {
  useWorkshop((w) => w.shards)
  return useShards(againName)
}

/** The `lineage` field of an inline item, as a spread: nothing for a reference. */
/**
 * The event a reference entry names, as the signed event it always is: an
 * object hidden by reference, or a LIVE LINK's public object, is published
 * on its own, so it was signed here or verified with its signature when it
 * was read (lib/hidden.ts fromReference). Only an item carried inline, a
 * message, is ever a rumor. For a row with `ref` only.
 */
function referenced(inner: Rumor): NostrEvent {
  return inner as NostrEvent
}

function lineageOf(inner: Rumor | undefined, ref: Reference | undefined): { lineage?: string } {
  const l = ref ? null : itemLineage(inner)
  return l ? { lineage: l } : {}
}

/**
 * The lineage a row of yours answers to, as a spread: the one it kept when it
 * went by reference to fit its bag (MyDeployment `lineage`), else its own as
 * an inline item. What a row takes with it when it goes by reference.
 */
function keptLineage(d: Pick<MyDeployment, 'inner' | 'ref' | 'lineage'>): { lineage?: string } {
  return d.lineage ? { lineage: d.lineage } : lineageOf(d.inner, d.ref)
}

/** Why an EDIT stopped: the shard it moves is no longer among your deployments here. */
export const EDIT_GONE = 'That shard is no longer among what this device hid, so there is nothing to move.'
/**
 * Your rows after a scan claimed `claimed` among them: of an item carried
 * inline that a scan read in more than one version (its hider moved it,
 * with MOVE or EDIT, from another device; lib/hidden.ts itemLineage), only
 * the newest. Only where the scan claimed one of them: rows this device
 * already had are left as they are, so a move made here whose old copy
 * could not be taken down still lists that copy, to DELETE.
 */
export function newestOfMoved(rows: MyDeployment[], claimed: readonly MyDeployment[]): MyDeployment[] {
  const lineage = (d: MyDeployment): string | null => (d.ref ? null : itemLineage(d.inner))
  const touched = new Set(claimed.map(lineage).filter((l): l is string => l !== null))
  if (touched.size === 0) return rows
  const newest = new Map<string, number>()
  for (const d of rows) {
    const l = lineage(d)
    if (l && touched.has(l)) newest.set(l, Math.max(newest.get(l) ?? 0, d.inner.created_at))
  }
  return rows.filter((d) => {
    const l = lineage(d)
    return !l || !touched.has(l) || d.inner.created_at >= (newest.get(l) ?? 0)
  })
}

/**
 * The world with one copy of each moved item (MOVE, EDIT): a version read
 * from a bag that some relay still holds as it was before the move is the
 * same item, by the same hider and lineage (lib/hidden.ts itemLineage), and
 * only the newest version is drawn. Never one of this device's own rows,
 * which its hider must still be able to reach to DELETE, and never what
 * stands in a chest, which goes with its chest.
 */
export function oneVersionEach(items: WorldItem[]): WorldItem[] {
  const keyOf = (w: WorldItem): string | null => (w.lineage && w.author && !w.chestId ? `${w.author}:${w.lineage}` : null)
  const newest = new Map<string, number>()
  for (const w of items) {
    const k = keyOf(w)
    if (k) newest.set(k, Math.max(newest.get(k) ?? 0, w.event?.created_at ?? 0))
  }
  return items.filter((w) => {
    const k = keyOf(w)
    return w.mine || !k || (w.event?.created_at ?? 0) >= (newest.get(k) ?? 0)
  })
}

/** Whether a row is still in its bag as far as this device knows: not marked GONE FROM ITS BAG (MyDeployment `goneFrom`). */
export function inItsBag(d: Pick<MyDeployment, 'goneFrom'>): boolean {
  return d.goneFrom === undefined
}

/** Why a MOVE stopped: what it moves is no longer among your deployments here. */
export const MOVE_GONE = 'That is no longer among what this device hid, so there is nothing to move.'
/**
 * Whether HIDE AGAIN can hide a fresh copy of a row gone from its bag: one
 * carried inline (a reference names an object of its own: place it again
 * from the workshop or the feed), and in a room only while its door is here
 * (never a room bag no door names, §3.7.8).
 */
export function againHideable(d: Pick<MyDeployment, 'ref' | 'room'>, mine: readonly Pick<MyDeployment, 'eventId'>[]): boolean {
  return !d.ref && (!d.room || mine.some((m) => m.eventId === d.room?.doorId))
}

/**
 * HIDE AGAIN's fresh copy: the same item where it was, its kind, content and
 * tags, without the lineage `d` (a placement of its own, not a version of
 * anything), newer than the one it copies.
 */
export function freshCopyTemplate(previous: Pick<NostrEvent, 'kind' | 'content' | 'tags'>, createdAt: number): EventTemplate {
  return { kind: previous.kind, created_at: createdAt, content: previous.content, tags: previous.tags.filter((t) => !(t[0] === 'd' && /^[0-9a-f]{64}$/.test(t[1] ?? ''))).map((t) => [...t]) }
}

/** A key whose secret a step would drop: its name, the key, its event, and where an archived row of it says it was. */
export interface LostKey {
  name: string
  key: KeyItem
  event: NostrEvent
  place: HeldPlace | null
  /** The row being dropped is this key itself, not a chest it was forged into. */
  self: boolean
}

/** A step refused because it would drop the last copy of a key something of yours is sealed to. */
export interface KeyLoss {
  why: string
  keys: LostKey[]
}

/** Where a deployment row stands, as ITEMS keeps a place. */
function rowPlace(d: Pick<MyDeployment, 'lookupId' | 'bagId' | 'at' | 'plane' | 'height'>): HeldPlace {
  return { lookupId: d.lookupId, bagId: d.bagId, at: d.at, plane: d.plane, height: d.height }
}

/** The keys a deployment row of yours keeps the secret of: its own key, and each key forged inside it (its sealed contents). */
export function keysOfRow(d: MyDeployment, me: string): LostKey[] {
  const place = rowPlace(d)
  const own = d.key ? [{ name: d.key.name, key: d.key, event: d.inner as NostrEvent, place, self: true }] : []
  const inside: LostKey[] = []
  for (const e of d.sealed ?? []) {
    const ev = e as Partial<NostrEvent>
    if (typeof ev.id !== 'string' || ev.pubkey !== me || ev.kind !== KEY_KIND || !Array.isArray(ev.tags) || typeof ev.content !== 'string') continue
    const key = keyItemOf(ev as NostrEvent)
    if (key) inside.push({ name: key.name, key, event: ev as NostrEvent, place, self: false })
  }
  return [...own, ...inside]
}

/**
 * Which of these keys a step would drop for good, and why it is refused
 * (review of #614). Hiding no longer holds a key, so a key's only copy can be
 * its deployment row, or the sealed contents of a chest of yours it was
 * forged into. Dropping that while a chest or door of yours is sealed to it
 * would leave them unopenable. Refused when a candidate is kept nowhere after
 * the step (`mineAfter` rows and chests, ITEMS archived rows included, or
 * `alsoKept`) and something in `mineAfter` is sealed to it. ARCHIVE keeps it
 * (arkinox, 2026-11-06), and the step may then go ahead.
 */
export function keysLost(candidates: readonly LostKey[], mineAfter: readonly MyDeployment[], items: Record<string, HeldItem>, me: string, alsoKept: ReadonlySet<string> = new Set()): KeyLoss | null {
  const kept = new Set(alsoKept)
  for (const it of Object.values(items)) if (it.key) kept.add(it.key.itemPubkey)
  for (const k of madeKeys(mineAfter, me)) kept.add(k.key.itemPubkey)
  const lost: LostKey[] = []
  const lines: string[] = []
  let opened = 0
  for (const c of candidates) {
    const pk = c.key.itemPubkey
    if (kept.has(pk)) continue
    kept.add(pk)
    const opens = mineAfter.filter((m) => m.chest?.lockPubkey === pk && m.inner.pubkey === me)
    if (opens.length === 0) continue
    lost.push(c)
    opened += opens.length
    const names = opens.map((m) => `${m.chest!.door !== undefined ? 'door' : 'chest'} “${m.chest!.name}”`)
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    lines.push(`${c.self ? 'This key' : `The key “${c.name}” inside it`} opens ${list}.`)
  }
  if (lost.length === 0) return null
  return { why: `${lines.join(' ')} Delete or reseal ${opened === 1 ? 'that' : 'those'} first.`, keys: lost }
}

/** DELETE or FORGET of a deployment row of yours: its own key and the keys forged inside it (keysLost). */
export function rowLoss(d: MyDeployment, mine: readonly MyDeployment[], items: Record<string, HeldItem>, me: string): KeyLoss | null {
  return keysLost(keysOfRow(d, me), mine.filter((m) => m.eventId !== d.eventId), items, me)
}

/** rowLoss, in words, or null when the row may go. */
export function keyStillNeeded(d: MyDeployment, mine: readonly MyDeployment[], items: Record<string, HeldItem>, me: string): string | null {
  return rowLoss(d, mine, items, me)?.why ?? null
}

/** DELETE of an ITEMS row: keysLost for a key's row, null for anything else. */
export function itemStillNeeded(item: Pick<HeldItem, 'id' | 'type' | 'key' | 'name' | 'event' | 'place'>, mine: readonly MyDeployment[], items: Record<string, HeldItem>, me: string): string | null {
  if (item.type !== 'key' || !item.key) return null
  const rest = { ...items }
  delete rest[item.id]
  return keysLost([{ name: item.name, key: item.key, event: item.event, place: item.place, self: true }], mine, rest, me)?.why ?? null
}

/**
 * PLACE from ITEMS: freshCopyTemplate of an item, standing at a new place
 * (its `C` the build cursor's), every other tag as it was.
 */
export function copyTemplateAt(previous: Pick<NostrEvent, 'kind' | 'content' | 'tags'>, at: Position, plane: Plane, createdAt: number): EventTemplate {
  const t = freshCopyTemplate(previous, createdAt)
  return { ...t, tags: [['C', positionHex(at, plane)], ...t.tags.filter((tag) => tag[0] !== 'C')] }
}

/** Why PLACE is not on an ITEMS row, in words, or null when it is. */
export const PLACE_NOT_YOURS = 'Only what you made can be placed again.'
export const PLACE_COIN = 'A coin is money: placing it again would copy it.'
export const PLACE_NFT = 'A claim link is whoever holds it: placing it again would copy it.'
export const PLACE_KIND = 'Only an item, a message or a sound can be placed again from ITEMS.'

/**
 * What PLACE on an ITEMS row lines up (arkinox, 2026-11-06), or why not. Only
 * what the signed-in identity made itself: its event is theirs and its
 * author a fact (`verified`); something found or taken from someone else has
 * no PLACE (owner ruling). A key and a message are copied whole
 * (copyTemplateAt), a key keeping its keypair; a sound as PLACE AGAIN copies
 * it, its file sealed again under a fresh key (`reseal`). A message holding a
 * coin or a nonfungible.cash claim link is refused, as PLACE AGAIN refuses it
 * (repeatable), both being bearer things. So are a
 * chest, a door and a model: a chest's contents and a door's room are not
 * copied, and a model goes out from the workshop (MOVE TO WORKSHOP).
 */
export function placeCopyOf(item: Pick<HeldItem, 'type' | 'event' | 'verified' | 'key' | 'text' | 'audio'>, me: string): DeployPending | string {
  if (!me || item.event?.pubkey !== me || !item.verified) return PLACE_NOT_YOURS
  if (item.type === 'key' && item.key) return { type: 'key', key: item.key, copy: item.event }
  if (item.type === 'message' && item.text !== undefined) return findCashuToken(item.text) !== null ? PLACE_COIN : hasNftLink(item.text) ? PLACE_NFT : { type: 'message', text: item.text, copy: item.event }
  if (item.type === 'audio' && item.audio) return { type: 'audio', audio: item.audio, reseal: true }
  return PLACE_KIND
}

/**
 * FROM MY ITEMS in the chest composer (arkinox, 2026-11-09): an ITEMS row as
 * a chest content, or why not. The same rule as PLACE from ITEMS
 * (placeCopyOf: only what you made; arkinox, 2026-11-06: "Only items I
 * made"), and only an item (a keypair), the same key with all its settings.
 * Not a row filed away under ARCHIVED.
 */
export function chestCopyOf(item: Pick<HeldItem, 'type' | 'event' | 'verified' | 'key' | 'text' | 'audio' | 'archived'>, me: string): Extract<ChestContent, { kind: 'key' }> | string {
  if (item.archived) return PLACE_ARCHIVED
  const p = placeCopyOf(item, me)
  if (typeof p === 'string') return p
  return p.type === 'key' && p.copy ? { kind: 'key', key: p.key, copy: p.copy } : PLACE_ITEM_ONLY
}

/** Why FROM MY ITEMS leaves a row out, beyond placeCopyOf's reasons. */
export const PLACE_ARCHIVED = 'An archived item stays filed away. Unarchive it first.'
export const PLACE_ITEM_ONLY = 'Only an item goes in from ITEMS. A message or a sound has its own button.'

/** What FROM MY ITEMS lists: each ITEMS row chestCopyOf takes, newest first. */
export function chestCopiesOf(items: Record<string, HeldItem>, me: string): Array<{ item: HeldItem; content: Extract<ChestContent, { kind: 'key' }> }> {
  const out: Array<{ item: HeldItem; content: Extract<ChestContent, { kind: 'key' }> }> = []
  for (const item of Object.values(items)) {
    const content = chestCopyOf(item, me)
    if (typeof content !== 'string') out.push({ item, content })
  }
  return out.sort((a, b) => b.item.at - a.item.at)
}

/** A chest's item as the event template it is signed from: a copy as PLACE from ITEMS copies it, else the forged item's own. */
export function chestKeyTemplate(c: Extract<ChestContent, { kind: 'key' }>, at: Position, plane: Plane, createdAt: number): EventTemplate {
  return c.copy ? copyTemplateAt(c.copy, at, plane, createdAt) : keyInnerTemplate(c.key, at, plane, createdAt)
}

/** Whether a deploy is PLACE from ITEMS of a key or a message: a copy, never a composer's draft. */
export function placingCopy(pending: DeployPending | null): boolean {
  return !!pending && (pending.type === 'key' || pending.type === 'message') && !!pending.copy
}

/**
 * What a gone row's HIDE AGAIN asks first: a key item, a chest, or a message
 * carrying a cashu token may already stand somewhere else (another device may
 * have moved it), and a second copy duplicates a key or a token.
 */
export function hideAgainAsks(d: Pick<MyDeployment, 'type' | 'text'>): boolean {
  return d.type === 'key' || d.type === 'chest' || (d.type === 'message' && findCashuToken(d.text ?? '') !== null)
}

/** Why HIDE AGAIN does nothing for a row hidden by reference. */
export const HIDE_AGAIN_REF = 'This one names an object of its own. Place it again from your workshop or the feed.'
/** Why HIDE AGAIN does nothing for a row whose door is gone. */
export const HIDE_AGAIN_NO_DOOR = 'Its door is gone, so its room is too.'

/** Why HIDE AGAIN waits: a hide is still going out, and two rewrites at once could drop one. */
export const HIDE_AGAIN_BUSY = 'A hide is still going out. Try again when it lands.'
/** SEAL refused while a hide or another bag rewrite is going out (holdBags). */
export const SEAL_BUSY = 'Something is still going out. SEAL again when it lands.'
/** Why BROADCAST waits: a hide, HIDE AGAIN or another BROADCAST is rewriting a bag now (review of #595). */
export const BROADCAST_BUSY = 'A hide is still going out. BROADCAST again when it lands.'

/** Why a MOVE stopped: its bag on the relays no longer holds it (review of #595). */
export const MOVE_STALE = 'Moved or removed from another device since this one saw it. Find it where it stands now.'
/** Why a MOVE stopped: no relay answered whether its bag still holds it. */
export const MOVE_UNANSWERED = 'No relay answered, so this cannot tell whether it was moved from another device. Nothing was moved. Try again when one is reachable.'

/** What a moved thing is called where a move says what happened to it. */
function movedNoun(type: HiddenType): string {
  return type === 'key' ? 'item' : type === 'audio' ? 'sound' : type
}

/** Why an EDIT stopped: the shard was moved or changed since this device last saw it. */
export const EDIT_STALE = 'This shard was moved or changed from another device since this one saw it. Find it where it stands now and edit it there.'
/** Why an EDIT stopped, or what a failed move left: its old version is not back on any relay yet. */
export const PUT_BACK_PENDING = 'No relay took the moved shard, and none has taken its old version back yet, so its old place may not open until one does. EDIT, DELETE or BROADCAST it again to put it back.'

/** Waits before each retry of putting a failed move's old version back. */
const PUT_BACK_RETRY_MS = [400, 1200]

/** Why an EDIT stopped: no relay answered whether the shard is still as this device saw it. */
export const EDIT_UNANSWERED = 'No relay answered, so this cannot tell whether the shard was moved from another device. Try again when one is reachable.'

/** The name a pending deploy goes by in the bar and the ghost. */
export function pendingName(pending: DeployPending, shard: ShardModel | null): string {
  switch (pending.type) {
    case 'message': return messagePreview(pending.text)
    case 'key': return pending.key.name
    case 'chest': return pending.name
    case 'audio': return pending.audio.title
    case 'seed': return seedDraftName(pending.seed)
    default: return shard?.name ?? 'shard'
  }
}

/** Whether a pending deploy has nothing in it to hide. */
export function pendingEmpty(pending: DeployPending, shard: ShardModel | null): boolean {
  switch (pending.type) {
    case 'message': return pending.text.trim().length === 0
    case 'key': return pending.key.name.trim().length === 0
    // Being placed or moved, a chest is not empty: its contents come after (R18), or are already sealed.
    // A door holds no contents of its own: only its name is asked for.
    case 'chest': return !!pending.spot && !pending.move && (pending.name.trim().length === 0 || (!pending.door && pending.contents.length === 0))
    case 'audio': return !pending.audio.url
    case 'seed': return dnaTextRefusal(pending.seed.text) !== null
    default: return !shard || (shard.vertices.length === 0 && (shard.parts?.length ?? 0) === 0)
  }
}

/**
 * A region as one string: plane, height and aligned base. Two placements are in
 * the same bag exactly when these agree (spec §7.6: one bag per author, region
 * and height), and it costs no key to compute, so the deploy bar can ask it of
 * every cursor move.
 */
export function regionOf(at: Position, plane: Plane, height: number): string {
  return `${plane}:${height}:${alignedBase(at.x, height)}:${alignedBase(at.y, height)}:${alignedBase(at.z, height)}`
}

/** Your bag in a region, as this device knows it: its settings and how many of your things it holds. */
export interface OwnBag { region: string; settings: BagSettings; count: number; /** A cashu token is written in one of its messages. */ cashu: boolean }

/**
 * Your bag in this region, from `mine`, or null when this device knows of none.
 * The settings are the newest item's: every rewrite stamps them on every item
 * in the region, so they agree, and the newest is the latest word if not.
 */
export function ownBagIn(mine: MyDeployment[], region: string): OwnBag | null {
  // What is behind a door is in a room bag, whose settings are no one's to choose.
  const items = mine.filter((d) => !d.room && regionOf(positionOf(d), d.plane, d.height) === region)
  if (items.length === 0) return null
  const newest = items.reduce((a, b) => (b.createdAt > a.createdAt ? b : a))
  return { region, settings: { ...DEFAULT_BAG_SETTINGS, ...(newest.bag ?? {}) }, count: items.length, cashu: items.some((d) => d.inner.kind === MESSAGE_KIND && findCashuToken(d.inner.content) !== null) }
}

/** How long the upload of PLACE AGAIN's fresh audio copy waits on the signer: a person reads the prompt. */
const AUDIO_SIGN_PATIENCE_MS = 60_000

/**
 * The shard a deploy hides: the model at the deploy bar's size, pose, turns and
 * WALK setting. The pose goes out only where there is ground to stand on:
 * dataspace, at SNAP_MIN_HEIGHT and above (lib/pose.ts). Linked, it is drawn
 * from the author's event as they publish it: nothing of this deploy's size or
 * pose can travel with a reference. The same object when nothing changed, so an
 * untouched deploy stays untouched.
 */
export function posedForDeploy(model: ShardModel, link: boolean, bar: Pick<ShardsState, 'deployUp' | 'deploySpin' | 'deployTurn' | 'deployUnit' | 'deployConstrain'>, plane: Plane, height: number): ShardModel {
  if (link) return model
  const up = bar.deployUp && snapOffered(plane, height)
  const spin = up ? wrapSpin(bar.deploySpin) : 0
  // The TURN row turns this copy by quarter turns (lib/turn.ts); the workshop's model is never touched.
  const turned = turnShard(model, bar.deployTurn)
  const shard = turned === model && model.unit === bar.deployUnit && model.up === up && model.spin === spin ? model : { ...turned, unit: bar.deployUnit, up, spin }
  // The WALK setting goes out like the size (DECK-0003 §1.12).
  return withConstrain(shard, bar.deployConstrain)
}

/** What the deploy bar shows of the bag a shard goes into (deployBagMeter). */
export interface BagMeter {
  /** The bag's size once the shard is in it, in bytes, in the form it would go out in. */
  bytes: number
  /** Whether the shard goes by reference: large by itself, or because the bag would not hold it inline. */
  byReference: boolean
  /** Whether it goes by reference only because the bag is full (lib/bagFit.ts). */
  fitted: boolean
  /** The refusal the deploy would give, or null when it fits. */
  refusal: string | null
}

/**
 * A shard's inline entry as a deploy would write it, for measuring: its
 * payload, its client tag and canonical id, at a stand-in point (every point
 * is the same length of hex, so its size is the size anywhere). Built once
 * per posed shard: the payload and the hash are the costly part, and neither
 * depends on where the cursor is.
 */
export function plannedShard(shard: ShardModel, owner: string): NostrEvent {
  return plannedItem(shardInnerTemplate(shard, { x: 0n, y: 0n, z: 0n }, 0, Math.floor(Date.now() / 1000)), owner, false)
}

/**
 * Your rows in the bag a placement goes into: a room's behind `door`, else the
 * region's (`region`, as regionOf names it). `edit` is the row an EDIT
 * replaces, left out. Changes only when the target bag does.
 */
export function bagRowsFor(mine: readonly MyDeployment[], o: { region: string; door: OwnDoor | null; edit?: MyDeployment }): MyDeployment[] {
  const door = o.door
  const doorIds = door ? new Set(mine.filter((m) => m.chest?.door === door.height && roomOf(positionOf(m), m.plane, door.height) === roomOf(door.at, door.plane, door.height)).map((m) => m.eventId)) : null
  return mine.filter((m) => inItsBag(m) && m.eventId !== o.edit?.eventId && (doorIds ? !!m.room && doorIds.has(m.room.doorId) : !m.room && regionOf(positionOf(m), m.plane, m.height) === o.region))
}

/**
 * The bag a shard is going into, as this device knows it (`rows`, bagRowsFor),
 * with the shard (`planned`, plannedShard) in it in the form it would go out
 * in: by reference when it is large or when the bag would not hold it inline,
 * the same decision deploy makes (lib/bagFit.ts). An estimate: the relays'
 * copy, which deploy reads first, may hold entries this device has no row
 * for. `edit` is the row an EDIT replaces: one by reference stays so.
 */
export function deployBagMeter(rows: readonly MyDeployment[], planned: NostrEvent, o: { height: number; settings: BagSettings; owner: string; room: boolean; place: { at: Position; plane: Plane }; edit?: MyDeployment }): BagMeter {
  const before = rows.map(entryOf)
  const settings = o.room ? ROOM_BAG_SETTINGS : o.settings
  const lookupId = rows[0]?.lookupId ?? '0'.repeat(64)
  const hint = widestHint()
  const at = planned.tags.find((t) => t[0] === 'C')?.[1] ?? ''
  // Large by itself: its payload (the content) past the threshold, as wantsReference measures it.
  const large = o.edit ? !!o.edit.ref : new TextEncoder().encode(planned.content).length > REFERENCE_THRESHOLD_BYTES
  // What a full bag moves out into sealed entries, as signBag would (lib/bagFit.ts sealFor): the entries standing in it.
  const standing = new Set(before.flatMap((e) => (isReference(e) ? [] : [e.id])))
  const seals = before.flatMap((e, i) => (isReference(e) ? [] : sealFor(e, o.owner, i.toString(16).padStart(32, '0'), sealHint(), standing) ?? []))
  const held = heldBy(seals)
  if (large) {
    const es = mergeEntries(before, [['a', `${OBJECT_KIND}:${o.owner}:${'0'.repeat(32)}`, hint, at]])
    const fit = planFit(es, seals, (x) => growthRefusal(x, before, bagBytes(x, lookupId, o.height, settings, o.place, undefined, held)))
    return { bytes: bagBytes(withReferences(es, fit.convert), lookupId, o.height, settings, o.place, undefined, held), byReference: true, fitted: false, refusal: fit.refusal }
  }
  const es = mergeEntries(before, [planned])
  const candidate = referenceFor(planned, o.owner, '0'.repeat(32), hint)
  const measureHeld = (es: readonly BagEntry[]): number => bagBytes(es, lookupId, o.height, settings, o.place, undefined, held)
  const refusedHeld = (es: readonly BagEntry[]): string | null => growthRefusal(es, before, measureHeld(es))
  const plan = planFit(es, [...(candidate ? [candidate] : []), ...seals], refusedHeld)
  const written = withReferences(es, plan.convert)
  const byReference = !!candidate && plan.convert.has(candidate.key)
  return { bytes: measureHeld(written), byReference, fitted: byReference, refusal: plan.refusal }
}

/** The realistic ceiling for interactive scanning (spec §7.3 says 0..16). */
export const SCAN_MAX_HEIGHT = 12

export type DeployStatus = 'idle' | 'working' | 'done' | 'error'

interface ShardsState {
  pending: DeployPending | null
  /**
   * A chest handed back by a shard aimed into it (startDeployIntoChest): the
   * draft with the shard signed in when PUT IN CHEST ended the deploy, and as
   * it was when CANCEL did. useBuilder moves it into `itemDraft`, which is the
   * one place the chest composer restores from, the moment it is set. Not
   * written to `itemDraft` from here because useBuilder imports this store.
   */
  chestBack: ChestDraft | null
  /** The handed-back chest, taken: useBuilder owns it from here. */
  takeChestBack: () => ChestDraft | null
  /**
   * The workshop model a deploy from the bench was canceled on: useBuilder
   * ends BUILD mode and reopens the workshop on it, the moment it is set.
   */
  workshopBack: string | null
  /** The model to reopen, taken: useBuilder does the reopening. */
  takeWorkshopBack: () => string | null
  deployHeight: number
  /**
   * The height follows the model: the smallest region that holds all of it
   * (lib/deployFit), refitted as the cursor, zoom, scale or turn change, until
   * the + or - is pressed (arkinox, 2026-10-01).
   */
  deployHeightAuto: boolean
  /**
   * The size this deployment goes out at: one model unit is 2^deployUnit
   * gibsons, exactly as `unit` means on the shard itself. Seeded from the
   * shard's own unit when the deploy starts, so a deploy that never touches
   * the control places the shard at the size the workshop built it.
   * Meaningless for a message, which has no size.
   */
  deployUnit: number
  /**
   * Stand this deployment on the Earth: its bottom to the ground at the place
   * it is hidden, its +Z facing `deploySpin` (lib/pose.ts). Offered in
   * dataspace at SNAP_MIN_HEIGHT and above, and written into the payload only
   * when it is offered, so a shard can never claim to stand where there is no
   * ground under it.
   */
  deployUp: boolean
  /** The compass bearing the standing shard's +Z faces: whole degrees 0..359, clockwise from north. */
  deploySpin: number
  /** Quarter turns on X, Y and Z for this deployment only (lib/turn.ts); the model keeps its own. */
  deployTurn: Turns
  /**
   * Whether a walker can cross this deployment in WALK (DECK-0003 §1.12,
   * lib/walkConstrain.ts). Seeded from the shard's own setting when the
   * deploy or EDIT starts, and written into what is hidden, like SCALE; the
   * workshop's model keeps its own. A LIVE LINK is its author's, so it is
   * theirs too.
   */
  deployConstrain: Constrain
  setDeployConstrain: (c: Constrain) => void
  /** One more quarter turn about an axis (0 X, 1 Y, 2 Z), wrapping at four. */
  turnDeploy: (axis: 0 | 1 | 2) => void
  resetDeployTurn: () => void
  /**
   * The camera owns the spin: while this is on, orbiting turns the shard so
   * its +Z faces the way you are looking, which is how the bench presents it.
   * A preview control, never written to the wire; what lands is `deploySpin`
   * wherever it was left.
   */
  deployFollow: boolean
  /**
   * LIVE LINK, for an object from the Shard Feed: place it by reference to
   * the author's object (an `a` entry, spec §7.6), so it follows their edits,
   * instead of a copy that stays exactly as placed (ruling B1: copy by
   * default). Size, turns and the snap are the author's then, not this deploy's.
   */
  deployLink: boolean
  /**
   * The bag settings the deploy bar shows and the deploy writes: `H`, the
   * hint, the riddle (lib/hidden.ts BagSettings). They are the bag's, so they
   * start at your existing bag's settings when the cursor's region holds one
   * (seedDeployBag) and at the defaults when it does not.
   */
  deployBag: BagSettings
  /**
   * The bag the controls were seeded from: its region and the settings it had
   * then, or null when they start from the defaults. deploy() compares what
   * you chose with this to tell a change you made from a value you never
   * touched, so a riddle or hint written from another device since is carried
   * forward rather than overwritten (resolveBagSettings).
   */
  deployBagFrom: OwnBag | null
  /** Change some of the bag settings. */
  setDeployBag: (patch: Partial<BagSettings>) => void
  /**
   * Start the controls at this bag's settings when the region under the cursor
   * changes to one that holds your bag, or back at the defaults when it moves
   * from one that did to one that does not. Moving between regions with no bag
   * keeps what you set.
   */
  seedDeployBag: (bag: OwnBag | null) => void
  deployStatus: DeployStatus
  /**
   * The last placement that repeats (`repeatable`). A placement lines it up
   * again at once, with every setting as it went out and the STEP kept, so
   * the next copy is one move and one press away (arkinox, 2026-10-23:
   * "Maintain the scale and other settings from the previous placement so we
   * don't have to readjust every time"). useBuilder stands the copy down
   * where BUILD mode ends with the placement, and forgets this when the mode
   * turns on or off. After a CANCEL it stays, for PLACE AGAIN.
   */
  placedLast: PlacedLast | null
  /**
   * PLACE AGAIN: line the last placement up again, with its settings and
   * STEP. False, and nothing changes, while a deploy is up or hiding, or
   * when there is nothing to place again (againName).
   */
  placeAgain: () => boolean
  /** What the deploy is doing right now, for the button: computing, buying, publishing. */
  deployNote: string | null
  /** A seed's work being mined (DECK-0008 §7): the one stage of a hide CANCEL may still stop. */
  deployMining: boolean
  /** A HOSAKA purchase waiting for a yes: the price and the wait. Null when not asking. */
  deployAsk: { sats: number | null; seconds: number | null } | null
  deployError: string | null
  mine: MyDeployment[]
  discovered: Record<string, Hidden>
  /**
   * Only these authors' things are in the world while set: the /demo tour's
   * district steps (DemoScene.curated). Null everywhere else, which is the
   * whole world as always.
   */
  curated: readonly string[] | null
  setCurated: (authors: readonly string[] | null) => void
  deleted: Record<string, true>
  /** Bags taken down from here, by `author:lookupId`: what the public LOOT list matches on. */
  deletedBags: Record<string, true>
  scanning: boolean
  /** The region whose bag is being sent to the relays right now, by lookup id. */
  broadcasting: string | null
  /** Why the last broadcast failed, for the row that asked for it. */
  broadcastError: string | null
  /**
   * The region whose broadcast that was, by lookup id: the item card says
   * why its own LIVE did not go, and never another bag's reason (review of
   * #403: the switch moved onto the card, where the Shards panel's note is
   * out of sight).
   */
  broadcastFailed: string | null
  /** A world item clicked open, by its inner event id. */
  selectedSecret: string | null
  /** Whether the Nearby Loot list is on screen: what is decrypted where you stand. */
  nearbyOpen: boolean
  setNearbyOpen: (open: boolean) => void
  /** What VIEW on a Nearby Loot row will return to (lib/nearbyReturn.ts); null when nothing is pending. */
  nearbyReturn: NearbyReturn | null
  setNearbyReturn: (r: NearbyReturn | null) => void

  /** Place a workshop model; `from` 'workshop' when the bench's DEPLOY did it, so CANCEL goes back there. */
  startDeployShard: (shardId: string, from?: 'workshop') => void
  /** Move a shard you hid (EDIT): the deploy starts at its place, height, size and pose. */
  startEditShard: (eventId: string) => void
  startDeployMessage: (text: string) => void
  /** Hide a key the composer forged (B1 §3.1). */
  startDeployKey: (key: KeyItem) => void
  /** SEED: plant a DNA at the build cursor (DECK-0008). Its work is mined at COMMIT. */
  startDeploySeed: (seed: SeedDraft) => void
  /** Hide audio the composer encrypted and uploaded (DECK-0007). */
  startDeployAudio: (audio: AudioItem, opts?: { server?: string; reseal?: boolean }) => void
  /** The FADE stepper: the pending audio's full-volume sphere (a one-shot's trigger zone), in gibsons; undefined for the default, half the way to the wall. */
  setDeployFade: (fade: number | undefined) => void
  /** Hide a chest as the composer drafted it; its contents are signed (the aimed ones already are) and sealed when it is hidden. */
  startDeployChest: (draft: ChestDraft & { lock: ChestLock }) => void
  /** The hide bar's model row: what the chest being hidden wears. SCALE and WALK start from that model's own. */
  setDeployLook: (look: LookChoice) => void
  /** The rooms the door-name chip's X left this one placement out of (R2), as lib/doors roomOf says them: one X for each room, the innermost first. */
  deployLeaveOut: string[]
  /** Leave this placement out of one more room; null asks every room again. */
  setDeployLeaveOut: (room: string | null) => void
  /**
   * The placement joining a room of yours on its own (autoRoomFor): that room,
   * and the height chosen before the room's took its place, which comes back
   * when the cursor leaves the room or the X leaves it out. Null when none.
   */
  deployRoomSnap: { room: string; chosen: number; kept: { up: boolean; follow: boolean; hint: BagSettings['hint'] } } | null
  /** SEAL IN ROOM on a MOVE or EDIT: the thing moved joins the room under it, as a new placement would. Off until asked; every new deploy starts it off. */
  deploySealMove: boolean
  setDeploySealMove: (on: boolean) => void
  /** Join the room under the placement, or leave it, as autoRoomFor says now. Called on every change it depends on; safe to call again. */
  syncRoomSnap: () => void
  /** A door being placed: the height of its own room, when the ROOM HEIGHT row set it; else the height it is hidden at. */
  deployDoorHeight: number | null
  setDeployDoorHeight: (h: number | null) => void
  /** ADD on a door: the height the next placement starts at, the door's (4.8). */
  deployInto: number | null
  /** SEAL A DOOR (4.2): a door on the hide bar to place first. */
  startPlaceDoor: () => void
  /** The door whose SEAL is going out now, or null: its rows wait, and no other SEAL starts (sealIntoRoom). */
  sealingRoom: string | null
  /** DOOR: seal what you already hid in its room, at any height, into it (R3): a rewrite of both bags for each bag they leave, each at the room's height after. A refusal in words, or null. */
  sealIntoRoom: (doorId: string, eventIds: string[]) => Promise<string | null>
  /** EDIT on a door of yours: name and label, and a new lock, which rotates the room key (R10). A refusal in words, or null. */
  resealDoor: (eventId: string, draft: Pick<ChestDraft, 'name' | 'requires'> & { lock: ChestLock }) => Promise<string | null>
  /** DELETE on a door of yours (R12): one of several goes alone; the last moves what is behind it out, or with `contents` deletes it. A refusal in words, or null. */
  deleteDoor: (eventId: string, contents: boolean) => Promise<string | null>
  /** CONVERT TO DOOR on a chest of yours (R13): a door where it stood, the same lock, what it holds in the new room. A refusal in words, or null. */
  convertToDoor: (eventId: string) => Promise<string | null>
  /** SEAL A CHEST (R18): an empty chest on the hide bar to place first; a draft BUILD kept comes back filled. */
  startPlaceChest: (draft?: ChestDraft | null) => void
  /** PLACE CHEST: where it lands is fixed at the build cursor, and the chest modal fills it. */
  placeChest: () => void
  /** MOVE in the chest modal before it is sealed (or closing it): back to the hide bar, the draft kept. */
  unplaceChest: (draft?: ChestDraft) => void
  /** The chest modal's draft, kept on the chest being placed as it is typed, so closing the modal loses nothing. */
  keepChestDraft: (draft: ChestDraft) => void
  /** SEAL & PUBLISH in the chest modal: the draft sealed and hidden where it was placed. */
  sealPlacedChest: (draft: ChestDraft) => Promise<void>
  /** MOVE on a chest of yours: the hide bar, the chest and its look as they are, anywhere. */
  startMoveChest: (eventId: string) => void
  /**
   * MOVE on a key item, a message or hidden audio of yours (movable): the
   * hide bar with it lined up as it stands, at its own height and with its
   * bag's settings, so PLACE where it is changes nothing but its version.
   */
  startMoveItem: (eventId: string) => void
  /**
   * PLACE on an ITEMS row: line up a new instance of it at the build cursor
   * (placeCopyOf), which brings BUILD mode up. Null when lined up; why not,
   * in words, otherwise. A copy lined up again after a placement stands down
   * first; any other deploy lined up refuses.
   */
  placeFromItems: (id: string) => string | null
  /**
   * HIDE AGAIN on a row GONE FROM ITS BAG: a fresh copy (new id, no lineage)
   * hidden in its bag at its place, in the marked row's stead. Resolves to
   * null when it went out, else why not (and the row stays marked).
   */
  hideAgain: (eventId: string) => Promise<string | null>
  /**
   * FORGET on a row GONE FROM ITS BAG: this device's record of it goes.
   * Nothing is published. Refused, in words, for the last copy of a key
   * something of yours is sealed to (keyStillNeeded); null otherwise.
   */
  forgetRow: (eventId: string) => string | null
  /**
   * The keys the last refused step would have dropped (keysLost), for the
   * ARCHIVE it offers beside its words; null otherwise.
   */
  lostKeys: LostKey[] | null
  /** ARCHIVE on a refused step: an archived ITEMS row for each key it would have dropped, so the step can then go ahead. */
  archiveLost: () => void
  /** What a chest of yours holds, as sealed: kept from sealing, else opened with what opens it; a refusal in words otherwise. */
  chestEntries: (eventId: string) => Promise<BagEntry[] | string>
  /** EDIT and ADD on a chest of yours: sealed again with this draft (name, lock, label, contents) where it stands. A refusal in words, or null. */
  resealChest: (eventId: string, draft: ChestDraft & { lock: ChestLock }) => Promise<string | null>
  /**
   * Aim one shard of a chest draft through the deploy bar (arkinox,
   * 2026-10-10): the content at `contentIndex` is lined up as a shard deploy
   * that signs instead of hiding, and the whole draft rides with it. Nothing
   * happens for a content that is not a shard.
   */
  startDeployIntoChest: (draft: ChestDraft, contentIndex: number) => void
  setDeployHeight: (h: number) => void
  /** Set the size this deployment goes out at, inside the same bounds the workshop uses. */
  setDeployUnit: (unit: number) => void
  /** Stand it up, or lay it back on cyberspace axes as it was built. */
  setDeployUp: (up: boolean) => void
  /** Aim the standing shard: a compass bearing, wrapped into 0..359. */
  setDeploySpin: (spin: number) => void
  /** Hand the spin to the camera, or take it back. */
  setDeployFollow: (follow: boolean) => void
  setDeployLink: (link: boolean) => void
  /** Line up an object from the Shard Feed at the build cursor, as a copy. */
  startDeployObject: (object: FeedObject) => void
  /** The highest height the deploy bar offers: this machine's, or HOSAKA's when cloud compute is on. */
  deployCeiling: () => number
  /** Answer the ask: yes goes to HOSAKA, no keeps the shard pending. */
  confirmDeploy: () => void
  declineDeploy: () => void
  /**
   * Drop the lined-up deploy. Not once it is hiding: the key is being
   * computed and the bag sealed, and it finishes where it was placed, so a
   * CANCEL then would only pretend (found in review, 2026-10-07).
   */
  /**
   * Stand the deploy down. `asked` is CANCEL (or Escape) itself, as opposed to
   * BUILD mode ending under it: only then does a deploy from the workshop go
   * back to the workshop.
   */
  cancelDeploy: (asked?: boolean) => void
  /** Hide the pending thing at the cursor. `confirmed` is the yes to a HOSAKA ask. */
  deploy: (confirmed?: boolean) => Promise<void>
  /**
   * Take one item out of its bag. `keepObject`: a shard hidden by reference
   * whose object has just been resealed under the same `d` by an EDIT, so the
   * object is the moved shard's now and must not be retracted.
   */
  deleteInstance: (eventId: string, opts?: { keepObject?: boolean }) => Promise<void>
  /**
   * The bag addresses of this identity's own published doors in these
   * regions: a scan asks about their deletions even when no relay sent a bag,
   * because a bag retracted whole from another device sends nothing.
   */
  ownDoorAddresses: (lookupIds: Iterable<string>) => string[]
  /**
   * After a scan: a door of yours whose bag its author (you, from another
   * device) retracted, with no newer bag standing, is gone (§3.7.8), as
   * publishing there already finds (gatherInners). `bags` are the bags the
   * scan opened (lib/bagVersions.ts), `deletions` the ones it was told of.
   */
  honorRetractions: (lookupIds: Iterable<string>, bags: readonly NostrEvent[], deletions: readonly NostrEvent[]) => void
  /**
   * Before a scan files what it opened: the finds on screen read from an
   * older version of a bag it opened, or from a bag its author deleted, go
   * (lib/bagVersions.ts staleFinds). The newer version files again whatever
   * it still holds (`refiled`, what the scan read), and a chest or a door it
   * still holds keeps what is in it.
   */
  dropStale: (bags: readonly NostrEvent[], deletions: readonly NostrEvent[], refiled: readonly Hidden[]) => void
  /**
   * Take one content out of a chest of yours that this device opened: the
   * chest is sealed again without it and the bag rewritten with the new chest
   * in the old one's place. Resolves to null when done, else the sentence
   * that says why not (not your chest, no key to open it, already gone).
   */
  removeFromChest: (eventId: string) => Promise<string | null>
  /** Send a region's bag to the relays now: what LOCAL deferred. */
  broadcast: (lookupId: string) => Promise<boolean>
  /**
   * Ask the relay what is hidden in one region you hold the key to, and open
   * it. The region's height comes from the held key or your own deployment
   * there, because a bag need not carry `H` (spec §8.6). Resolves to how
   * many items it opened, or -1 when the relays could not be read (the
   * canonical relay refused or was not heard from, and no other relay's bag
   * opened anything).
   */
  rescan: (lookupId: string, keyHex: string) => Promise<number>
  selectSecret: (eventId: string | null) => void
  /** File what a scan opened. A find this identity wrote joins `mine` as well, whichever device placed it. */
  /**
   * Add finds. Nothing found opens or is held: OPEN opens a chest, TAKE
   * holds (takeFound); only a chest opened by hand before is opened again
   * (store/useOpenedChests). `watched`: found by Cyberspace TV, not in play,
   * so not even that, and its keys, once taken, are held as watched
   * (review of #390).
   */
  addDiscovered: (items: Hidden[], how?: { watched?: boolean }) => void
  /**
   * TAKE on found items, by event id (arkinox, 2026-10-26: "i want to TAKE
   * them"): every keypair item among them that is still found here goes into
   * ITEMS, once. One only Cyberspace TV showed is held as watched, so it
   * opens nothing by itself, as before. Returns what was new.
   */
  takeFound: (eventIds: string[]) => HeldItem[]
  /**
   * The items among these that earn the reveal and the toast: never opened on
   * this device before, not this identity's own, not deleted. The scan and a
   * rescan both ask here, so "new" means one thing everywhere.
   */
  freshOf: (items: Hidden[]) => Hidden[]
  setScanning: (scanning: boolean) => void
  /**
   * Prove the round trip a stranger would make: derive the key from the
   * coordinate (discoveryKeyOf), require it to be the key and lookup id this
   * device sealed the bag with, ask the relays, open what comes back.
   * `wrongKey`: the derived key or lookup id is not the stored one, so the bag
   * is sealed where no stranger looks (a wrong key bought from HOSAKA, say);
   * the relay is not asked. `underived`: the derivation itself failed (the
   * region worker crashed or ran out of time), so nothing was compared and the
   * relay was not asked either. A row GONE FROM ITS BAG is not compared, and
   * the relay says it is missing. `refused` means the bag came back and this item is
   * in it, but the format refuses it, so no client can show it; the fix is in
   * the workshop, not on the relay. `unread`: no relay's bag held it, and the
   * canonical relay refused (no AUTH) or was not heard from, so nothing is
   * known either way. Where this device cannot derive the key (above its
   * ceiling, or a room without its door secret) the stored key is used, and
   * `key` says so.
   */
  testDiscovery: (eventId: string) => Promise<DiscoveryResult>
  pendingShard: () => ShardModel | null
  worldItems: () => WorldItem[]
  /**
   * What the world draws: worldItems, less what stays in an opened chest
   * and floats out of it as loot instead (lib/looks.ts keptInChest).
   */
  drawnItems: () => WorldItem[]
  /**
   * What hidden audio is heard from (scene/HiddenAudio): every audio item in
   * worldItems, one that stays in an opened chest included, so audio sealed
   * in a chest autoplays at the chest once it is opened, as it did before
   * the chest ceremony (#533). drawnItems leaves such an item out of what is
   * drawn, never out of what is heard; its card and ITEMS still play it.
   */
  heardAudio: () => WorldItem[]
  /** The clicked item, mine or discovered, as one shape. */
  secretByEvent: (eventId: string) => WorldItem | null
}

/** The store's list until followIdentity has read the identity's own. */
const NOT_READ_YET: MyDeployment[] = []
/**
 * Event ids this device has ever opened, newest last. `discovered` is memory
 * only and starts empty on every load, so without this the first scan after a
 * reload revealed everything it opened again, with the decode and the toast,
 * as if it had never been found (arkinox, 2026-09-25). Ids only: the items
 * themselves are refetched from the relay as they always were.
 */
const SEEN_KEY = 'onosendai:seen'
/** Enough for years of finds; the oldest fall off past it. */
const SEEN_MAX = 5000

function loadSeen(): Set<string> {
  try {
    const list = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')
    return new Set(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [])
  } catch { return new Set() }
}
const seen = loadSeen()

/**
 * Finds that came in play this session (a scan, a chest opened, the found
 * cache's played bags), by event id, for one identity: switching identity
 * starts it over, so what another identity found in play never makes a find
 * TV showed this one a played key (review of #519). A find not among them
 * was only shown by Cyberspace TV, and TAKE holds it as watched (takeFound).
 */
const played = { owner: '', ids: new Set<string>() }
function playedFinds(owner: string): Set<string> {
  if (played.owner !== owner) { played.owner = owner; played.ids = new Set() }
  return played.ids
}

function remember(ids: string[]): void {
  let added = false
  for (const id of ids) if (!seen.has(id)) { seen.add(id); added = true }
  if (!added) return
  const list = [...seen].slice(-SEEN_MAX)
  if (list.length < seen.size) { seen.clear(); for (const id of list) seen.add(id) }
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(list)) } catch { /* quota or private mode */ }
}
const DELETED_KEY = 'onosendai:deployments-deleted'
/** Bags this identity has taken down, by `author:lookupId`, which is a loot row's own key. */
const DELETED_BAGS_KEY = 'onosendai:bags-deleted'

/**
 * A row whose shard cannot be drawn. It stays stored and is never listed: drawing
 * one throws during render, and placing a fractional unit throws above the boundary.
 */
function unreadable(d: MyDeployment): boolean {
  if (!d?.shard) return false
  try {
    const s = normalizeStored(d.shard)
    return !Array.isArray(s.vertices) || !Array.isArray(s.faces) || clampUnit(s.unit) !== s.unit
  } catch { return true }
}

/** A stored row as the app reads it. Only for a row that is not unreadable. */
function normalizedRow(d: MyDeployment): MyDeployment {
  if (d.shard) return { ...d, shard: normalizeStored(d.shard) }
  // A chest's look is stored once, in its inner event (storedRow).
  const look = d.chest && !d.chest.look ? chestItemOf(d.inner)?.look : undefined
  return look ? { ...d, chest: { ...d.chest!, look } } : d
}

function loadMine(owner: string): MyDeployment[] {
  const out: MyDeployment[] = []
  for (const { row, json } of entriesIn(owner)) {
    if (!isListed(row) || unreadable(row)) continue
    const d = normalizedRow(row)
    noteStored(d, json)
    out.push(d)
  }
  return out
}

/**
 * A row as stored. A chest's look is in its inner event already, and a built-in's
 * is some 20 KB a side: kept twice it was 39,800 bytes a row. It comes back from
 * the inner event on load (normalizedRow).
 */
function storedRow(d: MyDeployment): string {
  if (!d.chest?.look) return JSON.stringify(d)
  const { look: _inInner, ...chest } = d.chest
  void _inInner
  return JSON.stringify({ ...d, chest })
}

export function storedMine(mine: readonly MyDeployment[]): string {
  return `[${mine.map(storedRow).join(',')}]`
}

const BAG_NOT_READ = 'No relay answered, so this bag could not be read. Nothing was changed. Try again when one answers.'
const SWITCHED = 'You switched identity while this was on its way, so it was not sent.'
/** The room's newest bag does not open with its key (lib/hidden.ts BagUnreadable): its rows are left as they are. */
const ROOM_UNREADABLE = 'The room behind this door does not open with its key. Nothing has changed.'
/** The deploy bar's note while a hide waits for a HIDE AGAIN or BROADCAST to land (holdBags). */
const BAG_WAIT_NOTE = 'Waiting for a bag already going out'
/** The hide waiting on the bag lock, if one is: CANCEL may end it, since it has signed nothing yet. */
let deployWaiting: DeployPending | null = null

/** What this list leaves out but must stay stored: rows no list shows. */
const notShown = (d: MyDeployment | null): boolean => !isListed(d) || unreadable(d)

/** Whether the list reached disk. Only what changed is written. When it did not, a toast says so: it shows whatever is open. */
function saveMine(mine: MyDeployment[], owner = useCyberspace.getState().identity.pubkey): Promise<boolean> {
  return saveRows(owner, sealedStateOf(mine), storedRow, notShown).then((ok) => {
    // What you hid is on the relays if it went LIVE, but this device forgets it
    // on a reload: say so, rather than lose your own record in silence.
    if (!ok) useToast.getState().show({ label: 'NOT SAVED ON THIS DEVICE', meta: 'This device has no room left for the record of what you hid. If it went LIVE, a scan where you hid it brings it back.', mark: 'build' })
    return ok
  })
}

/** One identity's rows: the store's while it is the one signed in, its own stored ones once it is not. */
function rowsOf(owner: string): MyDeployment[] {
  return useCyberspace.getState().identity.pubkey === owner ? useShards.getState().mine : loadMine(owner)
}

/** Write one identity's rows where rowsOf reads them, so work a switch landed during never touches the next identity's list. */
function commitRows(owner: string, rows: MyDeployment[]): Promise<boolean> {
  const next = sealedStateOf(rows)
  if (useCyberspace.getState().identity.pubkey === owner) useShards.setState({ mine: next })
  return saveMine(next, owner)
}

/** These rows with the sealed state this session knows (withSealedState): the same array when nothing changes. */
function sealedStateOf(rows: MyDeployment[]): MyDeployment[] {
  if (sealedByItem.size === 0) return rows
  let changed = false
  const out = rows.map((d) => { const n = withSealedState(d); if (n !== d) changed = true; return n })
  return changed ? out : rows
}

/** The unclaimed rows that could be claimed: a reference with what opens its bag, not deleted here. */
function claimableRows(): MyDeployment[] {
  const deleted = loadDeleted()
  return entriesIn(UNCLAIMED).flatMap((e) => (e.row?.ref && e.row.inner && e.row.keyHex && e.row.lookupId && !deleted[e.row.eventId] ? [e.row] : []))
}

/**
 * Move to this identity the unclaimed rows its own bags name. The bag's signature
 * says who placed what it names, and only the row's own key opens it. A row no
 * relay can vouch for yet stays unclaimed and is asked about on the next load.
 * It asks for all of this identity's bags and looks here, so the relays never
 * learn that another identity's lookup ids are on this device.
 */
async function claimUnclaimed(owner: string): Promise<void> {
  const rows = claimableRows().filter((d) => !unreadable(d))
  if (rows.length === 0) return
  const bags = await query({ kinds: [HIDDEN_KIND], authors: [owner] })
  const claimed: MyDeployment[] = []
  for (const d of rows) {
    for (const bag of bags) {
      if (bag.pubkey !== owner || bag.tags.find((t) => t[0] === 'd')?.[1] !== d.lookupId) continue
      const entries = await bagEntries(bag, hexToBytes(d.keyHex)).catch(() => [])
      if (entries.some((e) => standsFor(e, d))) { claimed.push(d); break }
    }
  }
  if (claimed.length === 0) return
  const have = new Set(rowsOf(owner).map((d) => d.eventId))
  const added = claimed.filter((d) => !have.has(d.eventId)).map(normalizedRow)
  // Committed to the owner first, and taken off the unclaimed only once that reached disk.
  if (!await commitRows(owner, [...rowsOf(owner), ...added])) return
  const gone = new Set(claimed.map((d) => d.eventId))
  const left = entriesIn(UNCLAIMED).flatMap((e) => (e.row && !gone.has(e.row.eventId) ? [e.row] : []))
  await saveRows(UNCLAIMED, left, JSON.stringify, (d) => d === null)
}

function loadDeleted(): Record<string, true> {
  try {
    const raw = localStorage.getItem(DELETED_KEY)
    if (!raw) return {}
    const list = JSON.parse(raw)
    const out: Record<string, true> = {}
    if (Array.isArray(list)) for (const id of list) if (typeof id === 'string') out[id] = true
    return out
  } catch { return {} }
}

function saveDeleted(deleted: Record<string, true>): void {
  try { localStorage.setItem(DELETED_KEY, JSON.stringify(Object.keys(deleted))) } catch { /* quota or private mode */ }
}

/**
 * The bags this identity has taken down.
 *
 * `deleted` above is keyed by the event id of the thing inside a bag, which
 * is the right key for the Stash and for a scan. The public LOOT list is a
 * list of bags, keyed by author and lookup id, and it never asked the Stash
 * anything, so a bag taken down still appeared there. This is the key that
 * list can match, and it lives on disk because that list survives a reload.
 */
export function loadDeletedBags(): Record<string, true> {
  try {
    const raw = localStorage.getItem(DELETED_BAGS_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    const out: Record<string, true> = {}
    if (Array.isArray(list)) for (const k of list) if (typeof k === 'string') out[k] = true
    return out
  } catch {
    return {}
  }
}

function saveDeletedBags(bags: Record<string, true>): void {
  try { localStorage.setItem(DELETED_BAGS_KEY, JSON.stringify(Object.keys(bags))) } catch { /* quota or private mode */ }
}

/**
 * How TEST DISCOVERY gets the key of a bag of yours. `derived`: from the
 * coordinate, as a stranger would (in a room, the room key from the derived
 * region key and the door secret, DECK-0004 §3.7.2), always off the main
 * thread. `stored`: the key this device sealed it with, because this device
 * cannot derive the region key at its height (`height`, above localKeyCeiling)
 * or holds no secret for its door (`door`). Decided without deriving anything,
 * so a card may ask it while it renders.
 */
export type DiscoveryKey = { via: 'derived' } | { via: 'stored'; why: 'height' | 'door'; height: number }

/** What TEST DISCOVERY found, and with which key (DiscoveryKey). */
export interface DiscoveryResult {
  outcome: 'found' | 'missing' | 'refused' | 'unread' | 'wrongKey' | 'underived'
  key: DiscoveryKey
}

/** Which key TEST DISCOVERY will use for a bag of yours (DiscoveryKey): a comparison, never a derivation. */
export function discoveryKeyOf(item: Pick<MyDeployment, 'height' | 'room'>, me: string): DiscoveryKey {
  if (item.height > localKeyCeiling()) return { via: 'stored', why: 'height', height: item.height }
  if (item.room && !doorSecret(me, item.room.doorId)) return { via: 'stored', why: 'door', height: item.height }
  return { via: 'derived' }
}

export function positionOf(d: { at: { x: string; y: string; z: string } }): Position {
  return { x: BigInt(d.at.x), y: BigInt(d.at.y), z: BigInt(d.at.z) }
}

/** The reverse: a position as the decimal strings a deployment keeps. */
/** The relays that took an event, as publishMany says (normalized), or `asked` when it did not say which. */
function tookOf(r: { ok: boolean; accepted?: string[] }, asked: string[] = relaySet()): string[] {
  return r.ok ? r.accepted ?? asked : []
}

function storedAt(p: Position): { x: string; y: string; z: string } {
  return { x: p.x.toString(), y: p.y.toString(), z: p.z.toString() }
}

/** What a deployment contributes to its region's bag: the reference if it has one (an object's, or a sealed entry's), else the inner event. */
function entryOf(d: Pick<MyDeployment, 'inner' | 'ref' | 'sealedRef'>): BagEntry {
  return d.ref ?? d.sealedRef ?? d.inner
}

/**
 * Every key an entry answers to: its entryKey, and for a reference to a sealed
 * entry whose item is known (read, or kept when sealed: lib/sealed.ts), that
 * item's id too. The same item inline and sealed is one entry.
 */
function entryKeys(e: BagEntry): string[] {
  const item = isReference(e) && isSealedRef(e) ? sealedItemOf(e) : undefined
  return item ? [entryKey(e), item.id] : [entryKey(e)]
}

/** Every key these entries answer to (entryKeys). */
function heldKeys(entries: readonly BagEntry[]): Set<string> {
  return new Set(entries.flatMap(entryKeys))
}

/** Whether a set of entry keys (heldKeys) holds this row: by its entry, or, for an item carried inline or sealed, by the item's id. */
function rowHeld(held: ReadonlySet<string>, d: Pick<MyDeployment, 'inner' | 'ref' | 'sealedRef'>): boolean {
  return held.has(entryKey(entryOf(d))) || (!d.ref && held.has(d.inner.id))
}

/**
 * Whether an entry of a bag stands for this row: its very entry, or its item
 * inline or in a sealed entry. A row this device has not yet seen sealed (or
 * unsealed) from another device still finds its entry, so a move or DELETE
 * takes out the one the bag holds, never leaving it behind.
 */
function standsFor(e: BagEntry, d: Pick<MyDeployment, 'inner' | 'ref' | 'sealedRef'>): boolean {
  if (entryKey(e) === entryKey(entryOf(d))) return true
  if (d.ref) return false
  return isReference(e) ? sealedItemOf(e)?.id === d.inner.id : e.id === d.inner.id
}

/** Union of bag entries by identity (event id, the reference's target, or the item a sealed entry holds), order preserved. */
function mergeEntries(a: BagEntry[], b: BagEntry[]): BagEntry[] {
  const seen = heldKeys(a)
  const out = a.slice()
  for (const e of b) {
    const ks = entryKeys(e)
    if (ks.some((k) => seen.has(k))) continue
    for (const k of ks) seen.add(k)
    out.push(e)
  }
  return out
}

/**
 * Where this session sealed an item of yours, by the item's id: which bag, the
 * reference, and the signed sealed entry (store signBag). A row written after
 * its bag was signed (a hide whose item went out sealed) takes it on when it is
 * committed (withSealedState), so every path that records a row records it
 * sealed without knowing it was.
 */
const sealedByItem = new Map<string, { lookupId: string; ref: Reference; event: NostrEvent }>()

/**
 * The plane of every room bag this session derived the lookup id of, by that
 * lookup id. A room is in its door's plane and holds no other (DECK-0004
 * §3.7.2, One plane), while an ordinary bag holds a region and its twin
 * (spec §7.6 Planes): gatherInners reads this to drop, from a room bag's
 * rewrite, an entry whose C is in the other plane, as invalid.
 */
const roomPlanes = new Map<string, Plane>()

/** A room's lookup id (DECK-0004 §3.7.2), recorded with its door's plane (roomPlanes). */
function roomLookupIn(key: Uint8Array, plane: Plane): string {
  const lookupId = roomLookupId(key)
  roomPlanes.set(lookupId, plane)
  return lookupId
}

/** The plane a bag entry names: an item's C, a reference's coordinate; null when it names none. */
function planeOfEntry(e: BagEntry): Plane | null {
  if (isReference(e)) {
    const c = e[3]
    return typeof c === 'string' && /^[0-9a-f]{64}$/.test(c) ? (parseInt(c[63], 16) & 1) as Plane : null
  }
  return eventPlace(e)?.plane ?? null
}

/** A bag's entries as a rewrite starts from them (gatherInners): the relays' and this device's, its settings, and the relays' newest version alone. */
interface Gathered {
  entries: BagEntry[]
  settings: BagSettings | null
  /** The relays' newest version of the bag, as read; [] when a relay answered with none; null when none was read (LOCAL, or no relay answered). */
  relay: BagEntry[] | null
}

/** The relays' newest version beside the entries gatherInners answered (gathered): signBag looks its `before` up here. */
const relayBagOf = new WeakMap<BagEntry[], BagEntry[]>()

/**
 * Fresh sealed entries that went out for a bag whose fate is not known (a
 * timeout: lib/sealed.ts SendResult `unsettled`), by owner and bag, until the
 * next write of that bag settles them: one it names stays, one it does not is
 * retracted once it is out. Session-local: a reload before then leaves them
 * on the relays, still sealed under the bag's key, which only that key opens.
 */
const unsettledSealed = new Map<string, Map<string, { ref: Reference; event: NostrEvent }>>()
const unsettledKey = (owner: string, lookupId: string): string => `${owner}:${lookupId}`

/** Forget what this session sealed (sealedByItem, unsettledSealed): on a change of identity, and in tests. */
export function forgetSealedState(): void {
  sealedByItem.clear()
  unsettledSealed.clear()
}

/** A row with the sealed entry this session put its item in, or without one its bag no longer has it in. */
function withSealedState(d: MyDeployment): MyDeployment {
  if (d.ref) return d
  const s = sealedByItem.get(d.inner?.id ?? '')
  if (!s || s.lookupId !== d.lookupId) return d
  if (d.sealedRef && entryKey(d.sealedRef) === entryKey(s.ref) && d.sealedEvent?.id === s.event.id) return d
  return { ...d, sealedRef: s.ref, sealedEvent: s.event }
}

/**
 * An inline item as it will be written, before anything is signed, to measure
 * its bag: its own canonical id, and a signature's length of stand-in (a
 * rumor carries none). The id is the one signing gives it, so what is measured
 * is keyed as what is written.
 */
function plannedItem(template: EventTemplate, owner: string, asRumor: boolean): NostrEvent {
  if (asRumor) return rumorOf(template, owner) as NostrEvent
  // Every signer adds ONOSENDAI's client tag (lib/client.ts): measured and hashed with it, as it is signed.
  const signed = attributed(template)
  return { ...signed, pubkey: owner, id: getEventHash({ ...signed, pubkey: owner }), sig: '0'.repeat(128) }
}

/**
 * The relay hint a reference is measured with before its object goes out: the
 * longest URL it could name. The object's reference names the relay that took
 * it (republish), never a longer one, so a bag measured this way still fits.
 */
function widestHint(): string {
  return relaySet().reduce((a, b) => (b.length > a.length ? b : a), '')
}

/**
 * The relay hint a sealed entry's reference carries: none, the empty string,
 * which spec §7.6 References allows ("It MAY be the empty string"). The bag is
 * signed before anything is sent, so a hint must be chosen before any relay
 * has answered; naming one made that relay the one that had to take every
 * sealed entry, and a single relay that refused kind 33335 stopped every
 * write to a full bag (review of #645, B1). With no hint, any of your relays
 * that takes the entry will do (lib/sealed.ts sendBagWithSealed), and the bag
 * goes only to those that took them all. A reader loses nothing: ONOSENDAI,
 * as the spec asks, looks first on the relays where it found the bag, and
 * never dials a hinted relay it does not already use.
 */
function sealHint(): string {
  return ''
}

/** A fresh `d` for one placement of an object: 16 random bytes, derived from nothing (DECK-0003 §3.4). */
function placementId(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)))
}

/**
 * A per-region clock so each rewrite of a bag is strictly newer than the last,
 * which is what makes the relay keep the new one (addressable replacement takes
 * the greatest created_at). Session-local; seeded from what is already on disk,
 * and moved past the relay's newest bag (gatherInners).
 *
 * It follows the relay's newest bag wherever that is, even past this device's
 * clock: a bag dated older than the one the relays hold is dropped by some
 * relays without a word and refused by others, and either way the hide is lost
 * (review of #599). It moves past this device's clock only by what the relays
 * hold or by one second a rewrite, never by a guess. Only a bag the relays
 * hold dated more than BAG_CLOCK_REFUSE_S ahead of this device's clock stops
 * it, in words: a rewrite newer than that would be refused for its date.
 */
export const BAG_CLOCK_REFUSE_S = 24 * 60 * 60
export const BAG_CLOCK_AHEAD = 'A bag from another of your devices is dated more than a day ahead. Nothing was sent. Fix that device\u2019s clock, then try again.'
const bagClock = new Map<string, number>()
export function nextBagAt(lookupId: string): number {
  const now = Math.floor(Date.now() / 1000)
  const at = Math.max(now, (bagClock.get(lookupId) ?? 0) + 1)
  if (at > now + BAG_CLOCK_REFUSE_S) throw new Error(BAG_CLOCK_AHEAD)
  bagClock.set(lookupId, at)
  return at
}

/** Note a bag the relays hold, so the next rewrite here is newer than it (nextBagAt). */
export function noteBagAt(lookupId: string, createdAt: number): void {
  bagClock.set(lookupId, Math.max(bagClock.get(lookupId) ?? 0, createdAt))
}

export const useShards = create<ShardsState>((set, get) => {
  const cyber = () => useCyberspace.getState()

  /**
   * Take down an object hidden by reference (NIP-09), once no bag names it. The same deletion RETRACT sends for a public object (lib/published.ts).
   * Only ever signed by the object's own author: after a switch, the identity signed in
   * now would publish a deletion naming the last one's object, which no relay honors and
   * which ties the two keys together in public (review of #597).
   */
  async function retractObject(object: NostrEvent, relays: string[] = relaySet()): Promise<void> {
    if (cyber().identity.pubkey !== object.pubkey) throw new Error(SWITCHED)
    const d = object.tags.find((t) => t[0] === 'd')?.[1] ?? ''
    const del = await cyber().signEvent(retractionTemplate(object.pubkey, d, object.id, Math.floor(Date.now() / 1000), 'hidden object removed'))
    await publishMany(relays, del)
  }

  /**
   * Whether the event at an object's address is still this very version, as
   * the relays answer: false when they hold a newer one (the shard was moved
   * by EDIT, here or from another device, and resealed under the same `d`),
   * and false when no relay answers, since a retraction by address would
   * delete whatever the address holds now (review of #369). Nothing seen
   * at all is this version, unchallenged.
   */
  async function addressStillThis(object: NostrEvent): Promise<'this' | 'newer' | 'silent'> {
    try {
      const answers = (await queryEach({ kinds: [object.kind], authors: [object.pubkey], '#d': [dOf(object)] })).filter((a) => a.outcome === 'answered')
      if (answers.length === 0) return 'silent'
      return answers.some((a) => a.events.some((e) => e.id !== object.id && e.created_at >= object.created_at)) ? 'newer' : 'this'
    } catch {
      return 'silent'
    }
  }

  /** Publish a signed event, retried after each of PUT_BACK_RETRY_MS while no relay takes it. */
  async function publishRetried(event: NostrEvent): Promise<boolean> {
    for (let i = 0; ; i++) {
      const ok = await publishMany(relaySet(), event).then((r) => r.ok, () => false)
      if (ok || i >= PUT_BACK_RETRY_MS.length) return ok
      await new Promise((r) => setTimeout(r, PUT_BACK_RETRY_MS[i]))
    }
  }

  /**
   * The row now holds `back`, which the relays hold: its version of the
   * shard, keyed by its id as a scan keys a sealed object, so a later EDIT
   * or DELETE does not read it as moved from another device.
   */
  function rekeyTo(eventId: string, back: NostrEvent, owner = cyber().identity.pubkey): MyDeployment | null {
    let row: MyDeployment | null = null
    // The rows of whoever the move was made as: a switch while the old version went back leaves the next identity's alone (#559 follow-up).
    const mine = rowsOf(owner).map((d) => {
      if (d.eventId !== eventId) return d
      const { putBack: _done, ...rest } = d
      row = { ...rest, eventId: back.id, inner: back }
      return row
    })
    void commitRows(owner, mine)
    if (cyber().identity.pubkey !== owner) return row
    // An EDIT lined up on this row follows it, in place, so the bar's MOVE
    // still finds the shard and deploy's own pending checks still hold.
    const pending = get().pending
    if (pending?.type === 'shard' && pending.edit?.eventId === eventId) {
      pending.edit.eventId = back.id
      pending.shardId = back.id
    }
    const discovered = { ...get().discovered }
    delete discovered[eventId]
    // The item card open on this row follows it to its new id, so PUBLISH
    // (broadcast puts a failed move back first) does not close the card it
    // was tapped on (arkinox, 2026-10-20: the wire record folded into it).
    set({ discovered, selectedSecret: get().selectedSecret === eventId ? back.id : get().selectedSecret })
    return row
  }

  /** A row whose old version no relay took back keeps it to put back (MyDeployment `putBack`), in its owner's rows. */
  function keepPutBack(eventId: string, back: NostrEvent, owner: string): void {
    void commitRows(owner, rowsOf(owner).map((d) => (d.eventId === eventId ? { ...d, putBack: back } : d)))
  }

  /** Put a failed move's old version back now (MyDeployment `putBack`): the row as it stands after, or null while no relay takes it. */
  async function putBackNow(eventId: string, owner = cyber().identity.pubkey): Promise<MyDeployment | null> {
    const d = rowsOf(owner).find((m) => m.eventId === eventId)
    if (!d?.putBack) return d ?? null
    if (!(await publishRetried(d.putBack))) return null
    return rekeyTo(eventId, d.putBack, owner)
  }

  /**
   * Build and publish the region bag, with its settings; `place` is any point in the region, for a hint's base.
   *
   * Never with a chest's contents beside it (arkinox, 2026-10-20: "I saw my
   * shards encrypted in my chest appear visibly ... chest contents should
   * not be shown on TV"). An entry that is sealed inside a chest in this
   * bag is left out, whichever rewrite brought it (a hide, DELETE, a move,
   * BROADCAST, taking something out of the chest): as a plain entry it is
   * sealed to the region alone, and anyone with the region key reads it,
   * every viewer of Cyberspace TV among them. The hider's own scans used to
   * claim a chest's contents as deployments (claimOwn), so this also mends
   * a record or a relay copy written that way, and a row that names
   * something left out goes from the record. What is inside is known from
   * the keys held here and the keys this identity made, held or not
   * (lib/inventory.ts hiderKeys; lib/chests.ts sealedInside), and from what this
   * session revealed out of those chests; a chest nothing here opens adds
   * nothing to leave out.
   *
   * `before` is the bag as it stood before this rewrite (gatherInners), for
   * a rewrite that takes a chest out: DELETE of the chest, or taking
   * something out of it, which puts a new chest in the old one's place.
   * What was sealed in the old chest stays out of the bag too (review of
   * #407): otherwise a bag written the old way would keep it beside the new
   * chest, or carry it loose with no chest at all.
   */
  async function publishBag(inners: BagEntry[], key: Uint8Array, lookupId: string, height: number, live: boolean, settings: BagSettings, place: { at: Position; plane: Plane }, beforeSend?: () => Promise<void>, before: BagEntry[] = [], owner = cyber().identity.pubkey): Promise<{ event: NostrEvent; published: boolean }> {
    const event = await signBag(inners, key, lookupId, height, settings, place, before, owner)
    try {
      // Anything that must go out only once the bag is signed (an EDIT's
      // resealed object): a signer that refuses the bag stops it here.
      if (beforeSend) await beforeSend()
      if (!live) {
        // LOCAL: the signed bag is the record, so what it sealed is the rows' now.
        settleSealed(event, true)
        return { event, published: false }
      }
      const result = await sendBag(event)
      return { event, published: result.ok }
    } finally {
      // Whatever happened, nothing it sealed waits to be recorded any more.
      bagSealed.delete(event)
    }
  }

  /**
   * What signBag sealed for a bag it signed: the sealed entries that must go
   * out before it (newly sealed, and any it names that the relays' newest
   * version did not), the sealed entries of yours the bag before it named and
   * it does not, to retract once it is out (spec §7.6 Writing, Retracting),
   * and the rows' sealed state, recorded only once the bag has gone out, or
   * stands as the LOCAL record (settleSealed).
   */
  const bagSealed = new WeakMap<NostrEvent, { sealed: OutgoingSealed[]; dropped: Reference[]; owner: string; lookupId: string; seals: { item: string; ref: Reference; event: NostrEvent }[]; settles: string[] }>()

  /**
   * What signBag sealed for this bag becomes the rows' (sealedByItem, then
   * the rows of that bag), when `ok`: the bag went out, or is the LOCAL
   * record. Otherwise nothing is recorded, so no row names a sealed entry
   * that no bag on a relay names. Either way it is forgotten.
   */
  function settleSealed(event: NostrEvent, ok: boolean): void {
    const pending = bagSealed.get(event)
    bagSealed.delete(event)
    if (!pending || !ok || pending.seals.length === 0) return
    for (const x of pending.seals) sealedByItem.set(x.item, { lookupId: pending.lookupId, ref: x.ref, event: x.event })
    const rows = rowsOf(pending.owner)
    const mine = sealedStateOf(rows)
    if (mine !== rows) void commitRows(pending.owner, mine)
  }

  /**
   * Send a signed bag (sendBagWithSealed): its sealed entries first, to the
   * relays that will take them; the bag only to the relays that took every
   * one; then the sealed entries it no longer names, retracted on the relays
   * that took it. A bag with none of either goes as it always did. What it
   * sealed is recorded only when it went out (settleSealed); fresh entries
   * whose bag may have been stored after all (a timeout) wait for the next
   * write of that bag (unsettledSealed).
   */
  async function sendBag(event: NostrEvent, relays: string[] = relaySet()): Promise<{ ok: boolean; reason?: string }> {
    const extra = bagSealed.get(event)
    try {
      if (!extra || (extra.sealed.length === 0 && extra.dropped.length === 0)) {
        const plain = await publishMany(relays, event)
        settleSealed(event, plain.ok)
        return plain
      }
      const result = await sendBagWithSealed(relays, event, extra.sealed, extra.dropped, {
        publish: publishMany,
        retract: async (ref, on) => {
          const known = unsettledSealed.get(unsettledKey(extra.owner, extra.lookupId))?.get(ref[1])?.event
          await retractSealedRef(ref, extra.owner, on, known)
        },
      })
      const key = unsettledKey(extra.owner, extra.lookupId)
      if (result.ok) {
        // The bag that went out settled every unsettled entry it was written over: named, it stays; not, it was retracted just now.
        const waiting = unsettledSealed.get(key)
        if (waiting) {
          for (const address of extra.settles) waiting.delete(address)
          if (waiting.size === 0) unsettledSealed.delete(key)
        }
      } else if (result.unsettled && result.unsettled.length > 0) {
        const waiting = unsettledSealed.get(key) ?? new Map<string, { ref: Reference; event: NostrEvent }>()
        for (const s of result.unsettled) { const ref = refOf(s) as Reference; waiting.set(ref[1], { ref, event: s.event }) }
        unsettledSealed.set(key, waiting)
      }
      settleSealed(event, result.ok)
      return result
    } finally {
      bagSealed.delete(event)
    }
  }

  /**
   * Retract a sealed entry of `owner`'s that no bag names now: emptied, then
   * deleted (lib/sealed.ts retractSealed), on `relays`: the ones that took the
   * bag that stopped naming it. Only ever signed by its own author: after a
   * switch it is left, as retractObject leaves an object.
   */
  async function retractSealedRef(ref: Reference, owner: string, relays: string[] = relaySet(), knownEvent?: NostrEvent): Promise<void> {
    const cs = cyber()
    if (cs.identity.pubkey !== owner || sealedRefParts(ref)?.pubkey !== owner) return
    const address = ref[1]
    const known = knownEvent ?? sealedEventOf(ref) ?? [...sealedByItem.values()].find((s) => s.ref[1] === address)?.event ?? rowsOf(owner).find((d) => d.sealedRef?.[1] === address)?.sealedEvent
    await retractSealed(ref, {
      me: owner,
      sign: (t) => { if (cyber().identity.pubkey !== owner) throw new Error(SWITCHED); return cs.signEvent(t) },
      publish: publishMany,
      fetch: (pubkey, d) => query({ kinds: [SEALED_KIND], authors: [pubkey], '#d': [d] }),
      relays,
      ...(known ? { known } : {}),
    })
    forgetReference(ref)
  }

  /**
   * Retract every sealed entry of `owner`'s among these entries, once per
   * address, after the bag that named them was deleted (spec §7.6
   * Retracting), on the relays that took the deletion. Best effort.
   */
  async function retractSealedAmong(entries: readonly BagEntry[], owner: string, relays: string[] = relaySet()): Promise<void> {
    const done = new Set<string>()
    for (const e of entries) {
      if (!isReference(e) || sealedRefParts(e)?.pubkey !== owner || done.has(e[1])) continue
      done.add(e[1])
      await retractSealedRef(e, owner, relays).catch(() => undefined)
    }
  }

  /** What signBag writes of `inners`: all of them but what a chest in the bag (or the bag before) seals inside, and that set. */
  function bagWritten(inners: BagEntry[], before: BagEntry[], owner: string): { entries: BagEntry[]; inside: Set<string> } {
    const looked = [...inners, ...before]
    const inside = sealedInside(looked, hiderKeys(useInventory.getState().items, get().mine, owner))
    const chests = new Set(looked.filter((e): e is NostrEvent => !isReference(e) && e.kind === CHEST_KIND).map((e) => e.id))
    for (const h of Object.values(get().discovered)) if (h.chestId && chests.has(h.chestId)) inside.add(h.eventId)
    return { entries: inside.size > 0 ? inners.filter((e) => !inside.has(entryKey(e))) : inners, inside }
  }

  /**
   * Which of `fresh` (entries this write is writing) go by reference so the bag
   * of `inners` fits (lib/bagFit.ts), measured as signBag measures and with
   * nothing signed; `refusal` is signBag's words when even that does not fit,
   * and the caller refuses with them before signing anything. `forced` are
   * candidates a caller already chose (sealRows, for every bag at once), in
   * their reference form from the start.
   */
  function fitByReference(inners: BagEntry[], fresh: BagEntry[], lookupId: string, height: number, settings: BagSettings, place: { at: Position; plane: Plane }, before: BagEntry[], owner: string, forced: ReadonlySet<string> = new Set(), seal: ReadonlySet<string> = new Set()): { refs: Map<string, FitCandidate>; refusal: string | null } {
    const hint = widestHint()
    // A fresh shard goes as a 33331 object; anything else, a shard already
    // standing in the bag included, may go as a sealed entry (lib/bagFit.ts
    // sealFor). What signBag will seal is planned again there, on the bag as
    // signed: here it only decides which shards become objects, and whether
    // the bag can be made to fit at all.
    const objects = fresh.flatMap((e) => (isReference(e) || seal.has(e.id) ? [] : referenceFor(e, owner, placementId(), hint) ?? []))
    const standing = new Set(before.flatMap((e) => (isReference(e) ? [] : [e.id])))
    const objectKeys = new Set(objects.map((c) => c.key))
    const seals = inners.flatMap((e) => (isReference(e) || objectKeys.has(e.id) ? [] : sealFor(e, owner, placementId(), sealHint(), standing, seal.has(e.id)) ?? []))
    const chosen = new Map([...objects, ...seals].filter((c) => forced.has(c.key) || seal.has(c.key)).map((c) => [c.key, c] as const))
    const held = heldBy(seals)
    const refused = (es: readonly BagEntry[]): string | null => {
      const written = bagWritten([...es], before, owner).entries
      return growthRefusal(written, before, bagBytes(written, lookupId, height, settings, place, undefined, held))
    }
    const plan = planFit(withReferences(inners, chosen), [...objects, ...seals].filter((c) => !chosen.has(c.key)), refused)
    const all = new Map([...chosen, ...plan.convert])
    return { refs: new Map([...all].filter(([, c]) => c.form === 'object')), refusal: plan.refusal }
  }

  /**
   * An inline shard of `owner`'s that a bag cannot hold inline, signed as the
   * kind 33331 object its reference names (lib/hidden.ts objectTemplateOf):
   * its own payload, sealed with the bag's key, under the candidate's `d`.
   */
  async function objectFor(entry: NostrEvent, c: FitCandidate, key: Uint8Array, createdAt: number, owner: string): Promise<NostrEvent> {
    const template = await objectTemplateOf(entry.content, key, c.d, createdAt)
    if (cyber().identity.pubkey !== owner) throw new Error(SWITCHED)
    return cyber().signEvent(template)
  }

  /**
   * The bag signed, and nothing sent: publishBag's first half, for what must sign
   * everything before anything goes out. Every bag write passes here, so here is
   * where one too large is refused, in words, before the signer is asked: past
   * what the canonical relay takes (lib/bagSize.ts) and larger than the bag it
   * replaces (`before`, which every caller reads first). A write that shrinks a
   * bag already past it (a DELETE, a REMOVE, a move out of it) still goes.
   */
  async function signBag(inners: BagEntry[], key: Uint8Array, lookupId: string, height: number, settings: BagSettings, place: { at: Position; plane: Plane }, before: BagEntry[] = [], owner = cyber().identity.pubkey, seal: ReadonlySet<string> = new Set()): Promise<NostrEvent> {
    // This work began under another identity: it must not be signed by, or touch the list of, the one signed in now.
    if (cyber().identity.pubkey !== owner) throw new Error(SWITCHED)
    const { entries: written, inside } = bagWritten(inners, before, owner)
    if (written.length < inners.length) {
      const mine = get().mine.filter((d) => !(d.lookupId === lookupId && inside.has(entryKey(entryOf(d)))))
      if (mine.length < get().mine.length) { set({ mine }); saveMine(mine) }
    }
    // Spec §7.6 Size: a bag that would pass the cap moves entries out into
    // sealed entries, the largest first, until it fits (lib/bagFit.ts sealFor:
    // never a door, a fresh shard goes as an object before this). `seal` are
    // items that go sealed whatever the size: a sealed entry moving to another
    // bag is sealed again there, under that bag's key and a fresh `d`, never
    // carried inline nor re-sealed at its old address (spec §7.6 The key,
    // DECK-0004 §3.7.7).
    const standing = new Set(before.flatMap((e) => (isReference(e) ? [] : [e.id])))
    const hint = sealHint()
    const candidates = written.flatMap((e) => (isReference(e) ? [] : sealFor(e, owner, freshSealedD(), hint, standing, seal.has(e.id)) ?? []))
    const forced = new Map(candidates.filter((c) => seal.has(c.key)).map((c) => [c.key, c] as const))
    const held = heldBy(candidates)
    const refused = (es: readonly BagEntry[]): string | null => growthRefusal(es, before, bagBytes(es, lookupId, height, settings, place, undefined, held))
    const plan = planFit(withReferences(written, forced), candidates.filter((c) => !forced.has(c.key)), refused)
    const chosen = plan.refusal ? forced : new Map([...forced, ...plan.convert])
    const entries = withReferences(written, chosen)
    const createdAt = nextBagAt(lookupId)
    const template = await bagTemplate(entries, key, lookupId, height, createdAt, HIDDEN_KIND, settings, place, heldBy(chosen.values()))
    // Larger than before, by what is sealed inside: the bag's size follows its plaintext.
    const tooBig = bagSizeRefusal(signedBytes(template))
    if (tooBig && utf8Bytes(JSON.stringify(entries)) > utf8Bytes(JSON.stringify(before))) throw new Error(tooBig)
    // Each sealed entry is signed before the bag, so a signer that refuses one
    // stops the write with nothing signed that names it. Nothing is recorded
    // in the rows yet: that waits until the bag has gone out (settleSealed).
    const sealedNow: OutgoingSealed[] = []
    const seals: { item: string; ref: Reference; event: NostrEvent }[] = []
    for (const c of chosen.values()) {
      const t = await sealedTemplate(c.item!, key, c.d, Math.floor(Date.now() / 1000))
      if (cyber().identity.pubkey !== owner) throw new Error(SWITCHED)
      const event = await cyber().signEvent(t)
      sealedNow.push({ event, hint: c.ref[2], fresh: true })
      rememberSealed(c.ref[1], c.item as Parameters<typeof rememberSealed>[1], event)
      seals.push({ item: c.key, ref: c.ref, event })
      forgetReference(c.ref)
    }
    if (cyber().identity.pubkey !== owner) throw new Error(SWITCHED)
    const bag = await cyber().signEvent(template)
    // What goes out first is what the bag names and no relay may have: the
    // entries just sealed, and any the relays' newest version of this bag did
    // not name (one sealed while LOCAL). Compared with what the relays hold
    // (gatherInners, relayBagOf), never with `before`, which holds this
    // device's rows too (review of #645, B2); by address throughout.
    const fresh = new Set(seals.map((x) => x.ref[1]))
    const { carry, dropped: droppedRefs } = sealedChanges(entries, before, relayBagOf.get(before) ?? null, owner, fresh)
    const carried: OutgoingSealed[] = carry.flatMap((e) => {
      const event = sealedEventOf(e) ?? [...sealedByItem.values()].find((x) => x.ref[1] === e[1])?.event ?? rowsOf(owner).find((d) => d.sealedRef?.[1] === e[1])?.sealedEvent ?? unsettledSealed.get(unsettledKey(owner, lookupId))?.get(e[1])?.event
      return event ? [{ event, hint: e[2] ?? '' }] : []
    })
    // Fresh entries a send that timed out left behind (unsettledSealed): this
    // bag settles each, keeping what it names and retracting what it does not.
    const named = new Set(entries.filter(isReference).map((e) => e[1]))
    const waiting = [...(unsettledSealed.get(unsettledKey(owner, lookupId))?.values() ?? [])]
    const dropped = [...droppedRefs as Reference[], ...waiting.filter((w) => !named.has(w.ref[1]) && !droppedRefs.some((e) => e[1] === w.ref[1])).map((w) => w.ref)]
    bagSealed.set(bag, { sealed: [...sealedNow, ...carried], dropped, owner, lookupId, seals, settles: waiting.map((w) => w.ref[1]) })
    return bag
  }

  /**
   * The author's current bag entries for a region: relay (authoritative) +
   * local. Entries, not just events: a reference in the relay's copy must
   * survive the rewrite even when this device never saw it.
   *
   * `settings` are the bag's current settings, from the relay's copy when there
   * is one (another device may have changed its riddle or hint since), else
   * from this device's own items in the region, else null for a region with no
   * bag yet. Every rewrite starts from these, so none drops a riddle or hint.
   */
  async function gatherInners(lookupId: string, key: Uint8Array, live: boolean, height: number, owner = cyber().identity.pubkey): Promise<Gathered> {
    // Whose bag this is, fixed now: the rows read, pruned and returned are this
    // identity's throughout. One signed in while the relays answer has rows of its
    // own at the same lookup id (a region's is the same whoever hides there), and
    // they are never pruned, marked or saved from here (review of #597).
    if (cyber().identity.pubkey !== owner) throw new Error(SWITCHED)
    const ownRows = (): MyDeployment[] => rowsOf(owner).filter((d) => d.lookupId === lookupId)
    const items = ownRows()
    // A row gone from its bag is never written back into it (goneFrom).
    const local = items.filter(inItsBag).map(entryOf)
    const localSettings = items.length > 0 ? items.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)).bag ?? DEFAULT_BAG_SETTINGS : null
    if (!live) return gathered(local, localSettings, null)
    /** After every wait on the relays: a switch meanwhile stops the rewrite here, before anything is pruned. */
    const still = (): void => { if (cyber().identity.pubkey !== owner) throw new Error(SWITCHED) }
    let relay: BagEntry[] = []
    let settings = localSettings
    let heard = false
    try {
      const answers = await queryEach({ kinds: [HIDDEN_KIND], authors: [owner], '#d': [lookupId] })
      still()
      const events = answers.flatMap((a) => a.events)
      heard = answers.some((a) => a.outcome === 'answered')
      const newest = events.sort((a, b) => b.created_at - a.created_at)[0]
      // The next rewrite must be newer than the relay's copy, or the relay keeps
      // that one: another device's clock may run ahead of this one's.
      if (newest) noteBagAt(lookupId, newest.created_at)
      // A bag retracted from another device, with a door of yours in it: that door is gone (§3.7.8).
      // A bag written in the same second as a retraction is the newer word.
      const retractedAt = await bagRetractedAt(lookupId, items, owner)
      still()
      if (retractedAt > (newest?.created_at ?? 0)) {
        pruneGoneRows(lookupId, new Set(), retractedAt, undefined, owner)
        return gathered(ownRows().filter(inItsBag).map(entryOf), localSettings, [])
      }
      // What a rotation that did not finish replaced stays out, whichever write comes first.
      const replaced = new Set(items.flatMap((d) => d.rotating ?? []).map((o) => o.doorId))
      // A room bag holds its door's plane only (roomPlanes): an entry in the other plane is dropped, as invalid.
      const roomPlane = roomPlanes.get(lookupId)
      relay = (newest ? await bagEntries(newest, key) : []).filter((e) => (isReference(e) || !replaced.has(e.id)) && (roomPlane === undefined || [null, roomPlane].includes(planeOfEntry(e))))
      still()
      // The bag's own sealed entries, opened: what each holds is what the
      // rewrite counts (§7.7) and what a row of yours is matched against when
      // its item went sealed, or came back inline, from another device.
      if (relay.some((e) => isReference(e) && sealedRefParts(e)?.pubkey === owner)) {
        const learned = await learnSealed(relay, owner, key, resolveReference)
        still()
        reconcileSealed(lookupId, relay, learned, owner)
      }
      // A relay copy that does not open with this key is not this bag.
      if (newest && relay.length > 0) {
        settings = bagSettingsOf(newest, height)
        // A row the relays' newer bag no longer holds was changed from another
        // device: its old self does not go back in beside the new one (§3.7.5;
        // a moved item, review of #595).
        pruneGoneRows(lookupId, heldKeys(relay), newest.created_at, undefined, owner)
      }
    } catch (err) {
      if (err instanceof Error && err.message === SWITCHED) throw err
      relay = []
      heard = false
    }
    // No relay answered, and a published bag here may name a row this device
    // cannot list yet. Writing from the list alone would drop that row from the
    // bag for good, or delete the whole bag as empty. A relay that answers with
    // nothing is an answer: there is no bag to lose.
    if (relay.length === 0 && !heard && claimableRows().some((d) => d.lookupId === lookupId && d.published)) throw new Error(BAG_NOT_READ)
    return gathered(mergeEntries(relay, ownRows().filter(inItsBag).map(entryOf)), settings, heard ? relay : null)
  }

  /**
   * What gatherInners answers, and the relays' newest version of the bag kept
   * beside its entries (relayBagOf), so signBag, handed those entries as
   * `before` by every caller, can tell what a relay already holds from what
   * only this device's rows hold.
   */
  function gathered(entries: BagEntry[], settings: BagSettings | null, relay: BagEntry[] | null): Gathered {
    if (relay) relayBagOf.set(entries, relay)
    return { entries, settings, relay }
  }

  /**
   * Rows of yours in this bag follow where the relays' newest version keeps
   * their item: in a sealed entry (the reference and the event take their
   * place in the row), or inline again (they leave it). Moved or sealed from
   * another device, the row still names the entry the bag holds.
   */
  function reconcileSealed(lookupId: string, relay: readonly BagEntry[], learned: ReadonlyMap<string, { item: Rumor; event: NostrEvent }>, owner: string): void {
    const inline = new Set(relay.flatMap((e) => (isReference(e) ? [] : [e.id])))
    const byItem = new Map<string, { ref: Reference; event: NostrEvent }>()
    for (const e of relay) {
      const l = isReference(e) ? learned.get(entryKey(e)) : undefined
      if (l && isReference(e) && !byItem.has(l.item.id)) byItem.set(l.item.id, { ref: e, event: l.event })
    }
    let changed = false
    const rows = rowsOf(owner).map((d) => {
      if (d.lookupId !== lookupId || d.ref) return d
      const s = byItem.get(d.inner.id)
      if (s) {
        sealedByItem.set(d.inner.id, { lookupId, ref: s.ref, event: s.event })
        if (d.sealedRef && entryKey(d.sealedRef) === entryKey(s.ref) && d.sealedEvent?.id === s.event.id) return d
        changed = true
        return { ...d, sealedRef: s.ref, sealedEvent: s.event }
      }
      if (inline.has(d.inner.id) && d.sealedRef) {
        sealedByItem.delete(d.inner.id)
        changed = true
        const { sealedRef: _ref, sealedEvent: _event, ...rest } = d
        void _ref
        void _event
        return rest
      }
      return d
    })
    if (changed) void commitRows(owner, rows)
  }

  /** When this bag's address was last retracted, 0 if never. Asked only of a bag holding a door of yours, the one row a retraction can leave standing here. */
  async function bagRetractedAt(lookupId: string, items: readonly MyDeployment[], owner: string): Promise<number> {
    if (!items.some((d) => d.chest?.door !== undefined && d.published)) return 0
    const address = `${HIDDEN_KIND}:${owner}:${lookupId}`
    const deletions = await query({ kinds: [5], authors: [owner], '#a': [address] })
    return deletions.filter((e) => e.pubkey === owner && e.tags.some((t) => t[0] === 'a' && t[1] === address)).reduce((at, e) => Math.max(at, e.created_at), 0)
  }

  /**
   * Whether a door of yours stands in this room that this device has no row for:
   * one sealed from another device and not scanned here yet. A second door here
   * would choose a second secret, and §3.7.5 asks for one. A finder holding one key
   * would see both doors open and reach only the room of the key they hold, until
   * they hold the other (store/rooms openDoorNow). One read and one derivation per
   * door sealed. It sees a door in the place's ordinary bag; one hidden inside another
   * room, LOCAL, or past what can be derived here, it cannot.
   */
  async function unseenDoorHere(at: Position, plane: Plane, height: number): Promise<boolean> {
    const cs = cyber()
    if (!cs.live || height > MAX_COMPUTE_HEIGHT) return false
    const me = cs.identity.pubkey
    const here = await regionKeyOffThread(at, height, MAX_COMPUTE_HEIGHT)
    const seen = await gatherInners(here.lookupId, here.key, true, height, me)
    const known = new Set(ownDoors(get().mine, me).map((d) => d.eventId))
    return seen.entries.some((e) => !isReference(e) && e.kind === CHEST_KIND && e.pubkey === me && !known.has(e.id) && doorHeightOf(e.tags) === height && eventPlace(e)?.plane === plane)
  }

  /**
   * What a version of a bag read just now says of your rows in it. A row it
   * holds knows that version held it (`bagAt`), and loses a GONE FROM ITS
   * BAG mark that version is newer than. For what it no longer holds, `held`
   * must be its WHOLE entry list (or empty, for a bag its author retracted
   * at `bagAt`): a door row goes (another device rotated, renamed or removed
   * it), and any other row is kept and marked `goneFrom` (moved or removed
   * elsewhere, or dropped by a stale rewrite; never lost). Only when that
   * version is NEWER than the one that last held the row, so
   * a relay's older copy never takes away what was hidden here, however far
   * the bag clock ran ahead of the wall clock; only a published row; never
   * one with a move to put back or a rotation under way, nor one from before
   * `bagAt` was kept (but a door, by its own time, as doors always were). Read before every rewrite (gatherInners), so a device
   * that missed a move never writes the old copy back into the bag, where no
   * device would list it any more (review of #595). `doorsOnly`: what a scan
   * reads, which may be only some of a bag's entries (TV's fresh finds, a
   * reference that could not be fetched), says nothing of what it lacks but
   * doors.
   */
  function pruneGoneRows(lookupId: string, held: ReadonlySet<string>, bagAt: number, opts?: { doorsOnly?: boolean }, owner = cyber().identity.pubkey): void {
    let changed = false
    const mine = rowsOf(owner).flatMap((d) => {
      if (d.lookupId !== lookupId) return [d]
      const door = d.chest?.door !== undefined
      // Held: that version knows it, and one newer than the version that lacked it clears the mark.
      // A scan (doorsOnly) touches no other row it finds, unless to clear its mark.
      if (rowHeld(held, d)) {
        if (opts?.doorsOnly && !door && d.goneFrom === undefined) return [d]
        const clears = d.goneFrom !== undefined && bagAt > d.goneFrom
        if (!clears && d.bagAt !== undefined && d.bagAt >= bagAt) return [d]
        changed = true
        const { goneFrom: _was, ...rest } = d
        void _was
        return [{ ...(clears ? rest : d), bagAt: Math.max(bagAt, d.bagAt ?? 0) }]
      }
      if (opts?.doorsOnly && !door) return [d]
      // A door row from before `bagAt` was kept goes by its old rule, its own time.
      const last = d.bagAt ?? (door ? d.createdAt : undefined)
      if (!d.published || d.putBack || d.rotating || last === undefined || last >= bagAt) return [d]
      if (!door && d.goneFrom !== undefined && d.goneFrom >= bagAt) return [d]
      changed = true
      // A door goes, as doors always did; anything else is kept, marked.
      return door ? [] : [{ ...d, goneFrom: bagAt }]
    })
    if (!changed) return
    // The rows of whoever's bag was read, wherever rowsOf found them.
    void commitRows(owner, mine)
  }

  /**
   * A find this identity wrote is a deployment, whichever device placed it.
   *
   * `mine` lives in this device's localStorage and was written only at deploy
   * time, so a bag hidden from the phone and opened by a scan on the desktop
   * went into `discovered` and no further: the Stash's DEPLOYED list stayed
   * empty there. The author is proven (unbag verified the inner signature
   * against the envelope's pubkey), and the find carries the inner event and
   * the key that opened it, which is everything a row needs to be rescanned,
   * broadcast or deleted from here. The relays are the set the scan asked.
   * What is already listed or deleted here stays as it is.
   */
  function claimOwn(items: Hidden[]): void {
    const me = cyber().identity.pubkey
    // A bag read just now says what it holds: a door of yours no longer in it was changed elsewhere.
    // Only doors: a scan's finds may be some of a bag's entries, not all (pruneGoneRows).
    const read = new Map<string, { at: number; held: Set<string> }>()
    for (const h of items) {
      if (h.chestId || h.author !== me || !h.inner || h.bagAt === undefined) continue
      const r = read.get(h.lookupId) ?? { at: h.bagAt, held: new Set<string>() }
      r.held.add(entryKey(h.ref ?? h.inner))
      read.set(h.lookupId, r)
    }
    for (const [lookupId, r] of read) pruneGoneRows(lookupId, r.held, r.at, { doorsOnly: true })
    const { mine, deleted } = get()
    const have = new Set(mine.map((d) => d.eventId))
    const own: MyDeployment[] = []
    // A LIVE LINK whose author published a newer version: the same row, its
    // stored copy refreshed, never a second row (review of #233).
    let refreshed = false
    const updated = mine.map((d) => {
      const h = items.find((x) => x.eventId === d.eventId && x.inner && d.ref && x.inner.id !== d.inner.id && x.inner.created_at > d.inner.created_at)
      if (!h || !h.inner) return d
      refreshed = true
      return { ...d, inner: h.inner, shard: h.shard ?? d.shard }
    }).map((d) => {
      // A row whose item a find read from a sealed entry, newer than the one the row names: the bag carries that one now.
      const h = d.ref ? undefined : items.find((x) => x.eventId === d.eventId && x.sealedRef && x.sealedEvent && x.lookupId === d.lookupId && (!d.sealedEvent || x.sealedEvent.created_at > d.sealedEvent.created_at || (d.sealedRef && entryKey(x.sealedRef) !== entryKey(d.sealedRef) && (x.bagAt ?? 0) >= (d.bagAt ?? 0))))
      if (!h) return d
      refreshed = true
      return { ...d, sealedRef: h.sealedRef, sealedEvent: h.sealedEvent }
    }).map((d) => {
      // A row read from a room follows that room: another device renamed its door or
      // rotated it, and a row left naming the old one counts as behind no door.
      const h = items.find((x) => x.eventId === d.eventId && x.room && x.keyHex)
      if (!h?.room || (d.room?.doorId === h.room.doorId && d.lookupId === h.lookupId)) return d
      refreshed = true
      return { ...d, room: h.room, lookupId: h.lookupId, keyHex: h.keyHex!, bagId: h.bagId, ...(h.bagAt !== undefined ? { bagAt: h.bagAt } : {}), height: h.height, bag: h.bag, published: true }
    })
    for (const h of items) {
      // What came out of a chest is the chest's, not an entry of the bag:
      // claimed, it was written into the bag beside the chest at the next
      // rewrite, readable by anyone with the region key (arkinox,
      // 2026-10-20: "chest contents should not be shown on TV").
      if (h.chestId) continue
      if (h.author !== me || !h.inner || !h.keyHex || have.has(h.eventId) || deleted[h.eventId]) continue
      have.add(h.eventId)
      own.push({
        eventId: h.eventId, inner: h.inner, ref: h.ref, bagId: h.bagId, ...(h.bagAt !== undefined ? { bagAt: h.bagAt } : {}), type: h.type, shard: h.shard, text: h.text, key: h.key, chest: h.chest, audio: h.audio,
        at: storedAt(h.at), plane: h.plane, height: h.height, lookupId: h.lookupId, keyHex: h.keyHex,
        relays: relaySet(), createdAt: h.createdAt, published: true, bag: h.bag, ...(h.room ? { room: h.room } : {}),
        // Read from a sealed entry: the row carries its reference, as the bag does.
        ...(h.sealedRef && h.sealedEvent ? { sealedRef: h.sealedRef, sealedEvent: h.sealedEvent } : {}),
      })
    }
    if (own.length === 0 && !refreshed) return
    // A reference resealed by a rotation has a new event id and the same address: the new row is it.
    const resealed = own.filter((o) => o.room && o.ref)
    const kept = [...updated.filter((d) => !d.room || !d.ref || !resealed.some((o) => o.inner.kind === d.inner.kind && dOf(o.inner) === dOf(d.inner) && o.inner.created_at > d.inner.created_at)), ...own]
    // An item of yours moved from another device (MOVE, EDIT) is read as a
    // new event under the same lineage: one row per item (newestOfMoved).
    const next = newestOfMoved(kept, own)
    set({ mine: next })
    saveMine(next)
  }

  /**
   * Whether the relays' newest version of a row's bag still holds it: 'gone'
   * when it does not (moved or removed from another device), or when its
   * author deleted the bag since; 'silent' when no relay answered.
   */
  async function stillInItsBag(d: MyDeployment): Promise<'this' | 'gone' | 'silent'> {
    const me = cyber().identity.pubkey
    let answers: Awaited<ReturnType<typeof queryEach>>
    try { answers = await queryEach({ kinds: [HIDDEN_KIND], authors: [me], '#d': [d.lookupId] }) } catch { return 'silent' }
    if (!answers.some((a) => a.outcome === 'answered')) return 'silent'
    const newest = answers.flatMap((a) => a.events).filter((e) => e.pubkey === me).sort((a, b) => b.created_at - a.created_at)[0]
    if (!newest) return 'gone'
    const address = `${HIDDEN_KIND}:${me}:${d.lookupId}`
    const deletions = await query({ kinds: [5], authors: [me], '#a': [address] }).catch(() => [] as NostrEvent[])
    if (retractedAt(address, deletions) >= newest.created_at) return 'gone'
    const entries = await bagEntries(newest, hexToBytes(d.keyHex)).catch(() => [] as BagEntry[])
    // Its item may stand in a sealed entry now, sealed from another device: opened, it is matched by its id.
    if (!d.ref && entries.some((e) => isReference(e) && sealedRefParts(e)?.pubkey === me)) await learnSealed(entries, me, hexToBytes(d.keyHex), resolveReference).catch(() => undefined)
    return entries.some((e) => standsFor(e, d)) ? 'this' : 'gone'
  }

  /** A look's own size and WALK setting, where SCALE and WALK start when it is picked. */
  function lookStart(look: LookChoice): { deployUnit: number; deployConstrain: Constrain } {
    const model = lookModelOf(look)
    return { deployUnit: model?.unit ?? 0, deployConstrain: model ? authoredConstrainOf(model) : CONSTRAIN_DEFAULT }
  }

  /** The same fresh-deploy state every start shares: no pose, no link, the bag settings at their defaults. */
  /**
   * What a new height changes on the hide bar. Below the snap's height there
   * is no snap: the control goes away, and so does what it was set to, rather
   * than lying in wait. A hint smaller than the region cannot contain it (spec
   * §7.7): the sector hint goes off above height 30 the way the snap goes off
   * below its own height.
   */
  const heightPatch = (height: number): Partial<ShardsState> => {
    const offered = snapOffered(buildPlane(cyber()), height)
    const bag = get().deployBag
    const hintGone = bag.hint !== null && !hintFits(bag.hint, height)
    return { deployHeight: height, deployAsk: null, ...(offered ? {} : { deployUp: false, deployFollow: false }), ...(hintGone ? { deployBag: { ...bag, hint: null } } : {}) }
  }

  /** Out of a room: the height chosen, and the pose and hint a room's height had dropped, where that height offers them again. */
  const leaveRoom = (snap: NonNullable<ShardsState['deployRoomSnap']>): Partial<ShardsState> => {
    const patch: Partial<ShardsState> = { deployRoomSnap: null, ...heightPatch(snap.chosen) }
    const s = get()
    if (snap.kept.up && !s.deployUp && snapOffered(buildPlane(cyber()), snap.chosen)) Object.assign(patch, { deployUp: true, deployFollow: snap.kept.follow })
    const bag = patch.deployBag ?? s.deployBag
    if (snap.kept.hint && !bag.hint && hintFits(snap.kept.hint, snap.chosen)) patch.deployBag = { ...bag, hint: snap.kept.hint }
    return patch
  }

  const freshDeploy = {
    deployLink: false, deployHeightAuto: false, deployUnit: 0, deployUp: false, deploySpin: 0, deployTurn: [0, 0, 0] as Turns, deployFollow: false, deployConstrain: CONSTRAIN_DEFAULT,
    deployBag: DEFAULT_BAG_SETTINGS, deployBagFrom: null, deployStatus: 'idle' as const, deployError: null,
    // A seed still mining for the deploy this replaces stops itself (plantSeed `current`); nothing of it stays on this bar.
    deployNote: null, deployMining: false,
  }

  /**
   * A chest's contents, signed one by one by this identity and sealed to the
   * lock (lib/chests.ts). Signing is here and not in the composer because the
   * contents carry the place they are hidden at, which is only known now, and
   * because a signer may be remote and slow, which the bar shows as work.
   * Returns the chest item for the inner template and the keys forged inside,
   * each with its signed event, for the inventory.
   */
  async function sealChest(draft: ChestDraft, at: Position, plane: Plane, createdAt: number, owner = cyber().identity.pubkey): Promise<{ chest: ChestItem; forged: Array<{ event: NostrEvent; key: KeyItem }>; entries: BagEntry[] }> {
    const cs = cyber()
    /** Before each signature: one signed in since never signs the chest's contents (review of #599). */
    const signAsOwner = (t: EventTemplate): Promise<NostrEvent> => {
      if (cyber().identity.pubkey !== owner) throw new Error(SWITCHED)
      return cs.signEvent(t)
    }
    if (!draft.lock) throw new Error('The chest has no lock.')
    const signed: BagEntry[] = []
    const forged: Array<{ event: NostrEvent; key: KeyItem }> = []
    for (const c of draft.contents) {
      if (c.kind === 'sealed') {
        // Already in the chest: kept exactly as it was sealed (EDIT, ADD).
        signed.push(c.entry)
      } else if (c.kind === 'message') {
        const text = c.text.trim()
        if (!text) continue
        // A rumor, never signed, in a chest as in a bag: the chest's
        // signature vouches for it (lib/chests.ts readContents).
        signed.push(rumorOf(messageInnerTemplate(text, at, plane, createdAt), cs.identity.pubkey))
      } else if (c.kind === 'shard') {
        // Aimed, it was signed where it should stand (startDeployIntoChest),
        // at its own size and pose: that event goes in as it is, so long as
        // this identity signed it (a draft outlives an identity switch).
        // Unaimed, the model is signed here, at the chest, as it always was.
        if (c.aimed) {
          if (c.aimed.signed.pubkey !== cs.identity.pubkey) throw new Error('A shard in this chest was aimed by another identity. AIM it again from the composer.')
          signed.push(c.aimed.signed)
          continue
        }
        const model = useWorkshop.getState().shards.find((s) => s.id === c.shardId)
        if (!model) throw new Error('A model in this chest is no longer in your workshop.')
        const refusal = shardRefusal(model)
        if (refusal) throw new Error(refusal)
        signed.push(await signAsOwner(shardInnerTemplate(model, at, plane, createdAt, creditOf(model))))
      } else if (c.kind === 'audio') {
        // A rumor, as in a bag (DECK-0007 §3): the chest's signature vouches for it.
        signed.push(rumorOf(audioInnerTemplate(c.audio, at, plane, createdAt), cs.identity.pubkey))
      } else {
        // A copy from ITEMS is the same key as this identity made it: one made by another (a draft outlives a switch) is not signed again as yours.
        if (c.copy && c.copy.pubkey !== cs.identity.pubkey) throw new Error('An item in this chest was made by another identity. Take it out and add it again.')
        const event = await signAsOwner(chestKeyTemplate(c, at, plane, createdAt))
        signed.push(event)
        forged.push({ event, key: c.key })
      }
    }
    if (signed.length === 0) throw new Error('The chest is empty.')
    const sealed = sealEntries(signed, draft.lock.pubkey)
    return { chest: { name: draft.name.trim(), lockPubkey: draft.lock.pubkey, senderPubkey: sealed.senderPubkey, requires: draft.requires.trim(), payload: sealed.payload }, forged, entries: signed }
  }

  /**
   * A chest of yours, signed again as `next` where it stands, in its old
   * one's place in the bag, and the bag published as it was (LIVE or LOCAL).
   * The deployment, its record among the finds and everything revealed from
   * it follow the new id, and the region's items the new envelope. `sealed`
   * is what it now holds, kept on this device (MyDeployment `sealed`).
   * REMOVE FROM CHEST, EDIT and ADD all end here.
   */
  async function replaceChest(chest: MyDeployment, next: ChestItem, sealed?: BagEntry[], onSigned?: (innerId: string) => Promise<void>, owner = cyber().identity.pubkey): Promise<MyDeployment> {
    const cs = cyber()
    // Begun as another identity (a switch while its signer opened the chest): not signed as this one.
    if (cs.identity.pubkey !== owner) throw new Error(SWITCHED)
    const me = owner
    const at = positionOf(chest)
    const createdAt = Math.max(Math.floor(Date.now() / 1000), chest.createdAt + 1)
    const inner = await cs.signEvent(chestInnerTemplate(next, at, chest.plane, createdAt))
    // Its id is known now, and nothing has gone out: what must reach disk first does.
    if (onSigned) await onSigned(inner.id)
    const key = hexToBytes(chest.keyHex)
    const wasPublic = rowsOf(me).some((d) => d.lookupId === chest.lookupId && d.published)
    // The bag as it really is (gatherInners, as deleteInstance explains),
    // with the new chest in the old one's place; a bag that somehow lacked
    // the chest gets it added rather than lost.
    const gathered = await gatherInners(chest.lookupId, key, wasPublic, chest.height, me)
    const entries = gathered.entries.some((e) => standsFor(e, chest))
      ? gathered.entries.map((e) => (standsFor(e, chest) ? inner : e))
      : [...gathered.entries, inner]
    const settings = gathered.settings ?? chest.bag ?? DEFAULT_BAG_SETTINGS
    const { event, published } = await publishBag(entries, key, chest.lookupId, chest.height, wasPublic, settings, { at, plane: chest.plane }, undefined, gathered.entries, me)
    // Before anything here changes: the relays still hold the chest as it was.
    if (wasPublic && !published) throw new Error('No relay took the new bag. The chest stays as it was.')
    let row: MyDeployment = chest
    const mine = rowsOf(me).map((d) => {
      if (d.eventId === chest.eventId) {
        row = { ...d, eventId: inner.id, inner, chest: next, createdAt, bagId: event.id, bagAt: event.created_at, published, bag: settings, ...(sealed ? { sealed } : {}) }
        if (!sealed) delete row.sealed
        return row
      }
      return d.lookupId === chest.lookupId ? { ...d, bagId: event.id, bagAt: event.created_at, published, bag: settings } : d
    })
    const discovered: Record<string, Hidden> = {}
    for (const h of Object.values(get().discovered)) {
      if (h.eventId === chest.eventId) { discovered[inner.id] = { ...h, eventId: inner.id, inner, chest: next, createdAt, bagId: event.id }; continue }
      if (h.chestId === chest.eventId) { discovered[h.eventId] = { ...h, chestId: inner.id, bagId: event.id }; continue }
      discovered[h.eventId] = h.author === me && h.lookupId === chest.lookupId ? { ...h, bagId: event.id } : h
    }
    // Seen already: the next scan finds the rewritten chest without a ceremony.
    remember([inner.id])
    if (cyber().identity.pubkey === me) set({ discovered, selectedSecret: get().selectedSecret === chest.eventId ? inner.id : get().selectedSecret })
    await commitRows(me, mine)
    return row
  }

  /** What stands behind a door follows it to its new id: a door is a new inner event whenever it is signed again. */
  function retargetRoom(from: string, to: string, owner = cyber().identity.pubkey): void {
    const rows = rowsOf(owner)
    if (from === to || !rows.some((d) => d.room?.doorId === from)) return
    void commitRows(owner, rows.map((d) => (d.room?.doorId === from ? { ...d, room: { doorId: to } } : d)))
  }

  /** The location key of a door's room: its bag's when that bag is of its height and not itself a room bag, else computed (§3.7.3). */
  async function doorLocation(d: MyDeployment): Promise<{ key: Uint8Array; lookupId: string; height: number }> {
    const height = d.chest?.door
    if (height === undefined) throw new Error('This is not a door.')
    if (!d.room && d.height === height) return { key: hexToBytes(d.keyHex), lookupId: d.lookupId, height }
    const rk = await regionKeyOffThread(positionOf(d), height, MAX_COMPUTE_HEIGHT)
    return { key: rk.key, lookupId: rk.lookupId, height }
  }

  /**
   * A room's bag key and lookup id this device already holds, with no key work
   * and nothing bought (review of #633): a row behind any of the room's doors
   * carries them, else a door of it hidden in the place's bag at the room's own
   * height carries the region key the room key is made from (§3.7.2). Null when
   * neither, or while the room's key is being rotated.
   */
  function heldRoomBag(doorId: string, secretHex: string): { key: Uint8Array; lookupId: string } | null {
    const door = get().mine.find((m) => m.eventId === doorId)
    const h = door?.chest?.door
    if (!door || h === undefined) return null
    const doors = doorRowsOfRoom(door)
    if (doors.some((d) => d.rotating)) return null
    const ids = new Set(doors.map((d) => d.eventId))
    const behind = get().mine.find((m) => !!m.room && ids.has(m.room.doorId) && inItsBag(m) && !m.putBack)
    if (behind) { roomPlanes.set(behind.lookupId, door.plane); return { key: hexToBytes(behind.keyHex), lookupId: behind.lookupId } }
    const plain = doors.find((d) => !d.room && d.height === h)
    if (!plain) return null
    const key = roomKey(hexToBytes(plain.keyHex), hexToBytes(secretHex))
    return { key, lookupId: roomLookupIn(key, door.plane) }
  }

  /** A room's bag: held here (heldRoomBag), or made from its region's key (doorLocation). */
  async function roomBagOf(door: MyDeployment, secretHex: string): Promise<{ key: Uint8Array; lookupId: string; height: number }> {
    const height = door.chest?.door
    if (height === undefined) throw new Error('This is not a door.')
    const held = heldRoomBag(door.eventId, secretHex)
    if (held) return { ...held, height }
    const place = await doorLocation(door)
    const key = roomKey(place.key, hexToBytes(secretHex))
    return { key, lookupId: roomLookupIn(key, door.plane), height: place.height }
  }

  /** Your door rows of one room, this one included (§3.7.5), among `rows` (the signed-in identity's unless named). */
  function doorRowsOfRoom(d: MyDeployment, rows: readonly MyDeployment[] = get().mine): MyDeployment[] {
    const h = d.chest?.door
    if (h === undefined) return [d]
    const room = roomOf(positionOf(d), d.plane, h)
    return rows.filter((m) => m.chest?.door === h && m.inner.pubkey === d.inner.pubkey && roomOf(positionOf(m), m.plane, h) === room)
  }

  /**
   * What is behind a door, as rows. While LIVE the relays are asked first, each on
   * its own, and whatever they hold is read into rows: a rewrite goes by rows, so
   * anything without one would be lost by it. Refuses, in words, when no relay
   * answered, or when the bag holds anything that could not be read (a reference
   * that cannot be fetched, or past the most a bag reads, MAX_REFERENCES_PER_BAG).
   *
   * The rows are `owner`'s, the identity the door's work began as: a switch while
   * the relays answer never refiles the next identity's rows, and stops here,
   * in words, before anything is read into rows (review of #597).
   */
  async function syncRoomRows(d: MyDeployment, secretHex: string, live: boolean, owner: string, seen?: { entries: BagEntry[] }): Promise<MyDeployment[] | string> {
    if (cyber().identity.pubkey !== owner) return SWITCHED
    const place = await doorLocation(d)
    const key = roomKey(place.key, hexToBytes(secretHex))
    const lookupId = roomLookupIn(key, d.plane)
    // Whichever door a row names: one replaced from another device leaves them naming it (pruneGoneRows).
    // In the room's own bag is what makes them this room's.
    const rows = (): MyDeployment[] => {
      const own = rowsOf(owner)
      const doors = new Set(doorRowsOfRoom(d, own).map((x) => x.eventId))
      const held = own.filter((m) => m.room && (doors.has(m.room.doorId) || m.lookupId === lookupId))
      if (held.some((m) => !doors.has(m.room!.doorId))) {
        const mine = own.map((m) => (m.room && m.lookupId === lookupId && !doors.has(m.room.doorId) ? { ...m, room: { doorId: d.eventId } } : m))
        void commitRows(owner, mine)
        return mine.filter((m) => m.room && (doors.has(m.room.doorId) || m.lookupId === lookupId) && inItsBag(m))
      }
      // A row gone from the room's bag (goneFrom) stays behind as it is: never
      // staged into a rotated or renamed room's new bag, nor out with a door's
      // contents (review 4 of #595).
      return held.filter(inItsBag)
    }
    if (!live) return rows()
    const asked = await queryEach({ kinds: [HIDDEN_KIND], authors: [d.inner.pubkey], '#d': [lookupId] })
    if (cyber().identity.pubkey !== owner) return SWITCHED
    const answers = asked.filter((a) => a.outcome === 'answered')
    if (answers.length === 0) return 'No relay answered, so this cannot tell what is behind the door. Nothing has changed. Try again when one is reachable.'
    // Both callers destroy what they do not see, and the relay that said nothing may hold the newest bag.
    if (answers.length < asked.length) {
      // Named, so the person knows which one to wait for, or to take out of their list.
      const quiet = asked.filter((a) => a.outcome !== 'answered').map((a) => a.url)
      const one = quiet.length === 1
      return `${quiet.join(' and ')} did not answer, and ${one ? 'it' : 'they'} may hold what is behind the door. Nothing has changed. Try again when ${one ? 'it answers' : 'they answer'}.`
    }
    const newest = answers.flatMap((a) => a.events).filter((e) => e.pubkey === d.inner.pubkey).sort((a, b) => b.created_at - a.created_at)[0]
    if (!newest) return rows()
    const { doorAsFound } = await import('./rooms')
    const found = doorAsFound(d.eventId)
    const h = BigInt(place.height)
    const at = positionOf(d)
    let read: Hidden[]
    try {
      read = await unbag(newest, key, resolveReference, { at: { x: (at.x >> h) << h, y: (at.y >> h) << h, z: (at.z >> h) << h }, plane: d.plane }, place.height, undefined, { doorId: found?.eventId ?? d.eventId })
    } catch (err) {
      // Read as empty, the rewrite after this would drop all of it.
      if (err instanceof BagUnreadable) return ROOM_UNREADABLE
      throw err
    }
    if (cyber().identity.pubkey !== owner) return SWITCHED
    // A room is in its door's plane (DECK-0004 §3.7.2, One plane): an entry in
    // the other plane is no find, and a rewrite drops it as invalid, so it is
    // counted as read below, never as one that blocks the rewrite.
    const otherPlane = read.filter((h) => h.plane !== d.plane)
    read = read.filter((h) => h.plane === d.plane)
    get().addDiscovered(read)
    // Filed under this door: what the relay names by any door of the room is one room.
    // A row's item may stand in a sealed entry: its id answers for it (entryKeys, read just now by unbag).
    const held = new Set(rows().flatMap((r) => [entryKey(entryOf(r)), ...(r.ref ? [] : [r.inner.id])]))
    // Deleted here and still on a relay, because none took the rewrite: read, and gone.
    const { deleted } = get()
    for (const h of read) if (deleted[h.eventId] && (h.ref ?? h.inner)) { held.add(entryKey((h.ref ?? h.inner)!)); if (h.sealedRef) held.add(entryKey(h.sealedRef)) }
    for (const h of otherPlane) if (h.ref ?? h.inner) { held.add(entryKey((h.ref ?? h.inner)!)); if (h.sealedRef) held.add(entryKey(h.sealedRef)) }
    const standing = await bagEntries(newest, key)
    // The room bag as the relays hold it, for a caller that retracts what it named (resealDoor).
    if (seen) seen.entries = standing
    const unread = standing.filter((e) => !entryKeys(e).some((k) => held.has(k))).length
    if (cyber().identity.pubkey !== owner) return SWITCHED
    if (unread > 0) return `${unread} behind this door could not be read here. Nothing has changed. Try again when they can be.`
    return rows()
  }

  /**
   * NIP-09 of a bag no door or row names any more, signed: by its address, and its last event when known.
   * Only by `owner`, the identity whose bag it is: never by one signed in since (retractObject).
   */
  async function bagRetraction(lookupId: string, bagId: string | null, owner: string): Promise<NostrEvent> {
    const cs = cyber()
    if (cs.identity.pubkey !== owner) throw new Error(SWITCHED)
    // On the bag's own clock: quick rewrites run it ahead of the wall's, and a relay keeps a bag newer than its deletion.
    return cs.signEvent({ kind: 5, created_at: nextBagAt(lookupId), content: 'hidden content removed', tags: [['a', `${HIDDEN_KIND}:${owner}:${lookupId}`], ...(bagId ? [['e', bagId]] : []), ['k', String(HIDDEN_KIND)]] })
  }

  /** Retract a bag, best effort: whether a relay took the retraction. */
  async function retractBag(lookupId: string, bagId: string | null, owner: string): Promise<boolean> {
    const del = await bagRetraction(lookupId, bagId, owner)
    try { return (await publishMany(relaySet(), del)).ok } catch { return false }
  }

  /** Where a move is going. */
  interface MoveTarget { key: Uint8Array; lookupId: string; height: number; room?: { doorId: string } }

  /** A move with everything signed and nothing sent (stageMove). */
  interface StagedMove {
    /** Whose move: its rows go on this identity's list, whoever is signed in by then. */
    owner: string
    rows: MyDeployment[]
    moved: MyDeployment[]
    /**
     * Each resealed object, and the old one signed again a second newer, to put
     * back if the move does not land. An inline shard that goes by reference to
     * fit the target (lib/bagFit.ts) is a new object with nothing to put back
     * (`back` absent): if the move does not land, it is retracted. Its
     * reference names `hint`, chosen before the bag is signed, so the move
     * goes only once that relay holds it.
     */
    objects: Array<{ rowId: string; next: NostrEvent; back?: NostrEvent; hint?: string }>
    to: MoveTarget
    settings: BagSettings
    bag: NostrEvent
    targetLive: boolean
    /**
     * The source without them, or its retraction when nothing is left, unless
     * the caller keeps it for last. `sealed` are the sealed entries of yours a
     * retracted source named, retracted after it (spec §7.6 Retracting).
     */
    source: { bag?: NostrEvent; retraction?: NostrEvent; settings?: BagSettings; sealed?: Reference[] } | null
  }

  /**
   * Rows of one bag moving into another: SEAL (R3) into a room, a last door's room
   * out into the place's ordinary bag, a rotation into the new room bag. This part
   * signs everything and sends nothing, so a signer that refuses leaves everything
   * as it was. A large shard of your own is sealed again under the target's key at
   * the same address, with the old version signed again to put back; a LIVE LINK
   * names a public object and only moves.
   */
  async function stageMove(rows: MyDeployment[], to: MoveTarget, keepSource: boolean, owner: string, byReference: ReadonlySet<string> = new Set()): Promise<StagedMove> {
    const cs = cyber()
    // Begun as `owner`, after awaits of the caller's own: never staged from, or signed as, one signed in since.
    if (cs.identity.pubkey !== owner) throw new Error(SWITCHED)
    const me = owner
    const src = rows[0]
    const srcKey = hexToBytes(src.keyHex)
    const sourceLive = get().mine.some((d) => d.lookupId === src.lookupId && d.published)
    // A LIVE door's bag stays LIVE when a LOCAL room's entries come into it.
    const targetLive = sourceLive || get().mine.some((d) => d.lookupId === to.lookupId && d.published)
    const now = Math.floor(Date.now() / 1000)
    // The target as it stands, and whether what comes into it fits: an inline
    // shard of yours goes by reference when the target would not hold it
    // inline (lib/bagFit.ts), the largest first; refused in words when even
    // that does not fit, before anything is signed. A resealed object keeps
    // its reference entry (the same address), so it is measured as it is.
    const target = await gatherInners(to.lookupId, to.key, targetLive, to.height, me)
    const settings = to.room ? ROOM_BAG_SETTINGS : target.settings ?? DEFAULT_BAG_SETTINGS
    const place = { at: positionOf(src), plane: src.plane }
    // An item in a sealed entry goes sealed again into the target, under the
    // target's key and a fresh `d` (spec §7.6 The key: a sealed entry belongs
    // to exactly one bag; DECK-0004 §3.7.7, never re-sealed at its old
    // address). It comes as the item, which signBag seals; the old sealed
    // entry is retracted once the source no longer names it.
    const reseal = new Set(rows.filter((r) => r.sealedRef && !r.ref).map((r) => r.inner.id))
    const coming = rows.map((r) => (reseal.has(r.inner.id) ? r.inner : entryOf(r)))
    const fit = fitByReference(mergeEntries(target.entries, coming), coming, to.lookupId, to.height, settings, place, target.entries, me, byReference, reseal)
    if (fit.refusal) throw new Error(fit.refusal)
    const moved: MyDeployment[] = []
    const objects: StagedMove['objects'] = []
    for (const r of rows) {
      if (reseal.has(r.inner.id)) {
        const { sealedRef: _ref, sealedEvent: _event, ...item } = r
        void _ref
        void _event
        moved.push(item)
        continue
      }
      // A candidate is an inline shard (lib/bagFit.ts referenceFor): its content is the object's payload.
      const fitted = r.ref ? undefined : fit.refs.get(entryKey(entryOf(r)))
      if (fitted) {
        const next = await objectFor(r.inner as NostrEvent, fitted, to.key, Math.max(now, r.inner.created_at + 1), owner)
        objects.push({ rowId: r.eventId, next, hint: fitted.ref[2] })
        moved.push({ ...r, eventId: next.id, inner: next, ref: fitted.ref, ...keptLineage(r) })
      } else if (r.ref && r.shard && r.inner.pubkey === me && r.inner.kind === OBJECT_KIND && r.inner.tags.some((t) => t[0] === 'encrypted')) {
        const at = Math.max(now, r.inner.created_at + 1)
        // Before each signature, as each follows a wait: one signed in since is never asked (review of #599).
        const template = await objectTemplate(r.shard, to.key, dOf(r.inner), at)
        if (cyber().identity.pubkey !== owner) throw new Error(SWITCHED)
        const next = await cs.signEvent(template)
        if (cyber().identity.pubkey !== owner) throw new Error(SWITCHED)
        const back = await cs.signEvent({ kind: r.inner.kind, created_at: at + 1, content: r.inner.content, tags: r.inner.tags })
        const ref = referenceTo(next, positionOf(r), r.plane, relaySet()[0] ?? '')
        objects.push({ rowId: r.eventId, next, back })
        moved.push({ ...r, eventId: next.id, inner: next, ref })
      } else moved.push(r)
    }
    const bag = await signBag(mergeEntries(target.entries, moved.map(entryOf)), to.key, to.lookupId, to.height, settings, place, target.entries, me, reseal)
    let source: StagedMove['source'] = null
    if (!keepSource) {
      const was = await gatherInners(src.lookupId, srcKey, sourceLive, src.height, me)
      const left = was.entries.filter((e) => !rows.some((r) => standsFor(e, r)))
      const kept = was.settings ?? src.bag ?? DEFAULT_BAG_SETTINGS
      if (left.length > 0) source = { bag: await signBag(left, srcKey, src.lookupId, src.height, kept, place, was.entries, me), settings: kept }
      else source = sourceLive ? { retraction: await bagRetraction(src.lookupId, src.bagId, me), sealed: was.entries.filter((e): e is Reference => isReference(e) && sealedRefParts(e)?.pubkey === me) } : {}
    }
    return { owner: me, rows, moved, objects, to, settings, bag, targetLive, source }
  }

  /**
   * The signed move's objects and new bag, out: a bag never names what no relay has.
   * If any relay step fails, the old versions go back and nothing has moved. A row
   * whose old version no relay took keeps it to put back (MyDeployment `putBack`).
   */
  async function sendMove(stage: StagedMove): Promise<void> {
    // LOCAL: the signed bag is the record, so what it sealed is the rows' now.
    if (!stage.targetLive) { settleSealed(stage.bag, true); return }
    const sent: StagedMove['objects'] = []
    const fail = async (words: string): Promise<never> => { await undoObjects(sent, stage.owner); throw new Error(words) }
    for (const o of stage.objects) {
      // A new object must be on the relay its reference names: a finder looks there.
      const ok = o.hint
        ? await publishMany([o.hint], o.next).then((r) => r.ok, () => false)
        : await publishMany(relaySet(), o.next).then((r) => r.ok, () => false)
      if (!ok) await fail('No relay took a shard being moved. Nothing has moved.')
      sent.push(o)
      const rest = o.hint ? relaySet().filter((u) => u !== o.hint) : []
      if (rest.length > 0) void publishMany(rest, o.next).catch(() => undefined)
    }
    const ok = await sendBag(stage.bag).then((r) => r.ok, () => false)
    if (!ok) await fail('No relay took the new bag. Nothing has moved.')
  }

  /** The old versions of what went out, back: the row follows (rekeyTo), or keeps it to put back. */
  async function undoObjects(sent: StagedMove['objects'], owner: string): Promise<void> {
    for (const o of sent) {
      // A new object no bag names now: taken back, as a hide that failed takes its object back.
      if (!o.back) { await retractObject(o.next).catch(() => undefined); continue }
      if (await publishRetried(o.back)) rekeyTo(o.rowId, o.back, owner)
      else keepPutBack(o.rowId, o.back, owner)
    }
  }

  /** A sent move's rows, and its source without them. Says so, in words, if no relay took the source: what moved has moved, and the old bag still names it until it is sent again. */
  async function finishMove(stage: StagedMove): Promise<void> {
    const src = stage.rows[0]
    const before = rowsOf(stage.owner)
    let sourcePublished = false
    if (stage.source?.bag) {
      if (before.some((d) => d.lookupId === src.lookupId && d.published)) sourcePublished = await sendBag(stage.source.bag).then((r) => r.ok, () => false)
      else settleSealed(stage.source.bag, true)
    }
    if (stage.source?.retraction) {
      const out = await publishMany(relaySet(), stage.source.retraction).catch(() => ({ ok: false as const, reason: '' }))
      // The bag is deleted: so is every sealed entry it named, on the relays that took the deletion.
      if (out.ok && stage.source.sealed) await retractSealedAmong(stage.source.sealed, stage.owner, tookOf(out))
    }
    const leaving = new Set(stage.rows.map((r) => r.eventId))
    const keyHex = bytesToHex(stage.to.key)
    const fresh = stage.moved.map((r): MyDeployment => {
      const { room: _was, putBack: _done, ...rest } = r
      void _was
      void _done
      return { ...rest, ...(stage.to.room ? { room: stage.to.room } : {}), lookupId: stage.to.lookupId, keyHex, height: stage.to.height, bagId: stage.bag.id, bagAt: stage.bag.created_at, published: stage.targetLive, bag: stage.settings }
    })
    const wasLive = before.some((d) => d.lookupId === src.lookupId && d.published)
    const mine = [
      ...rowsOf(stage.owner).filter((d) => !leaving.has(d.eventId)).map((d) => {
        if (d.lookupId === stage.to.lookupId) return { ...d, bagId: stage.bag.id, bagAt: stage.bag.created_at, published: stage.targetLive, bag: stage.settings }
        return d.lookupId === src.lookupId && stage.source?.bag ? { ...d, bagId: stage.source.bag.id, bagAt: stage.source.bag.created_at, published: sourcePublished } : d
      }),
      ...fresh,
    ]
    // The row is what speaks for it now; a find of the old place would draw it twice.
    const discovered = { ...get().discovered }
    for (const id of leaving) delete discovered[id]
    if (cyber().identity.pubkey === stage.owner) set({ discovered })
    await commitRows(stage.owner, mine)
    for (const o of stage.objects) forgetReference(fresh.find((f) => f.inner.id === o.next.id)?.ref ?? [])
    if (stage.source?.bag && wasLive && !sourcePublished) throw new Error('It moved, but no relay took the old bag without it. Send that bag again, or the old place still names it.')
  }

  /**
   * SEAL (R3): rows of yours in a room's cube, moved into its bag. One move for
   * each bag they come out of, since HERE lists every height (hereInRoom) and
   * each height is a bag of its own; one at a time, each reading the room bag
   * the one before wrote. The room bag as it will end is measured first, and
   * refused in words before anything is signed when it would pass what the
   * canonical relay takes (lib/bagSize.ts). A move that fails after others
   * went says how many did: never "nothing has moved".
   */
  async function sealRows(door: MyDeployment, secret: string, rows: MyDeployment[], me: string): Promise<string | null> {
    let moved = 0
    let stale = 0
    try {
      const room = await roomBagOf(door, secret)
      const to: MoveTarget = { key: room.key, lookupId: room.lookupId, height: room.height, room: { doorId: door.eventId } }
      const live = rows.some((r) => r.published) || get().mine.some((m) => m.lookupId === room.lookupId && m.published)
      const target = await gatherInners(room.lookupId, room.key, live, room.height, me)
      // The inline shards that go by reference so the room holds them all,
      // chosen once for every bag they come from (lib/bagFit.ts): each move
      // below takes them in that form, so the first never leaves too little
      // room for the last.
      const coming = rows.map(entryOf)
      const fit = fitByReference(mergeEntries(target.entries, coming), coming, room.lookupId, room.height, ROOM_BAG_SETTINGS, { at: positionOf(door), plane: door.plane }, target.entries, me)
      if (fit.refusal) return fit.refusal
      const byReference = new Set(fit.refs.keys())
      const bags = new Map<string, MyDeployment[]>()
      for (const r of rows) bags.set(r.lookupId, [...(bags.get(r.lookupId) ?? []), r])
      for (const group of bags.values()) {
        const done = await moveEntries(group, to, me, byReference)
        moved += done.moved
        stale += done.stale
      }
      return stale > 0 ? `${moved} OF ${rows.length} MOVED. ${stale} ${stale === 1 ? 'WAS' : 'WERE'} MOVED OR DELETED ON ANOTHER DEVICE.` : null
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      if (moved === 0) return why
      return `${moved} OF ${rows.length} MOVED. ${why.replace(/\s*Nothing has moved\.?/i, '').trim()}`
    }
  }

  /**
   * All of a move: sign everything, send the new, finish with the old. The bag
   * they come out of is read first: a row it no longer holds (moved or deleted
   * from another device, gatherInners marks it) is left out, before anything is
   * signed, so the move never brings it back (as MOVE_STALE refuses one). How many
   * moved, and how many were left out for that.
   */
  async function moveEntries(rows: MyDeployment[], to: MoveTarget, owner: string, byReference?: ReadonlySet<string>): Promise<{ moved: number; stale: number }> {
    if (rows.length === 0) return { moved: 0, stale: 0 }
    const src = rows[0]
    const sourceLive = get().mine.some((d) => d.lookupId === src.lookupId && d.published)
    const was = await gatherInners(src.lookupId, hexToBytes(src.keyHex), sourceLive, src.height, owner)
    const held = heldKeys(was.entries)
    const fresh = rows.filter((r) => rowHeld(held, r))
    if (fresh.length > 0) {
      const stage = await stageMove(fresh, to, false, owner, byReference)
      await sendMove(stage)
      await finishMove(stage)
    }
    return { moved: fresh.length, stale: rows.length - fresh.length }
  }

  /**
   * A HIDE AGAIN or BROADCAST rewriting a bag now, or null. Each reads the bag,
   * then writes it with what it read, and so does a hide: two at once at the
   * same bag and the later write drops what the earlier one added (a door
   * sealed in that window, then pruned as gone by the door rule). Neither
   * starts while a hide is working, nor while the other runs, and a hide that
   * starts meanwhile waits for it before it reads anything (review of #595).
   */
  let bagWork: Promise<unknown> | null = null
  function holdBags<T>(work: () => Promise<T>): Promise<T> {
    const running = work()
    bagWork = running
    const free = (): void => { if (bagWork === running) bagWork = null }
    running.then(free, free)
    return running
  }

  /** HIDE AGAIN's copy of a row gone from its bag (hideAgain), as `owner`, under the bag lock. */
  async function hideCopy(d: MyDeployment, owner: string): Promise<string | null> {
    const cs = cyber()
    const eventId = d.eventId
    // A FRESH copy where it was: a new id and no lineage `d`, so it is a
    // placement of its own, listed and deletable on every device, and never
    // read as the old version of something moved elsewhere (arkinox's
    // ruling, review 4 of #595). Hidden audio is sealed again under a fresh
    // key, as PLACE AGAIN's copy is, so no two placements share one.
    const at = positionOf(d)
    const now = Math.floor(Date.now() / 1000)
    try {
      let audio = d.audio
      let template: EventTemplate
      if (d.type === 'audio' && d.audio) {
        audio = { ...d.audio, ...(await resealCopy(d.audio, (t) => cs.signEvent(t, AUDIO_SIGN_PATIENCE_MS))) }
        template = audioInnerTemplate(audio, at, d.plane, Math.max(now, d.inner.created_at + 1))
      } else template = freshCopyTemplate(d.inner, Math.max(now, d.inner.created_at + 1))
      const rumor = d.type === 'message' || d.type === 'audio'
      const key = hexToBytes(d.keyHex)
      const existing = await gatherInners(d.lookupId, key, true, d.height, owner)
      const settings = d.room ? ROOM_BAG_SETTINGS : existing.settings ?? d.bag ?? DEFAULT_BAG_SETTINGS
      // Whether the copy fits inline, before it is signed: a shard goes by
      // reference when the bag would not hold it inline (lib/bagFit.ts), and
      // a bag that cannot hold it either way refuses it now, in words.
      const planned = plannedItem(template, owner, rumor)
      const fit = fitByReference(mergeEntries(existing.entries, [planned]), [planned], d.lookupId, d.height, settings, { at, plane: d.plane }, existing.entries, owner)
      if (fit.refusal) return fit.refusal
      const fitted = fit.refs.get(planned.id)
      // A message and hidden audio are rumors, never signed (spec §7.6). A
      // shard that goes by reference is signed only as its object.
      let inner = rumor ? rumorOf(template, owner) as NostrEvent : fitted ? planned : await cs.signEvent(template)
      let ref: Reference | undefined
      if (fitted) {
        // The object first: a bag never names what no relay has.
        inner = await objectFor(planned, fitted, key, template.created_at, owner)
        const took = await republish(inner)
        if (!took) return 'No relay took the shard. Try again when one is reachable.'
        ref = [fitted.ref[0], fitted.ref[1], took, ...fitted.ref.slice(3)]
        forgetReference(ref)
      }
      const sent = await publishBag(mergeEntries(existing.entries, [ref ?? inner]), key, d.lookupId, d.height, true, settings, { at, plane: d.plane }, undefined, existing.entries, owner)
        .catch(async (err: unknown) => { if (ref) await retractObject(inner).catch(() => undefined); throw err })
      const { event, published } = sent
      if (!published) {
        if (ref) await retractObject(inner).catch(() => undefined)
        return 'No relay took the bag. Try again when one is reachable.'
      }
      const { goneFrom: _was, ...rest } = d
      void _was
      const fresh: MyDeployment = { ...rest, eventId: inner.id, inner, ...(ref ? { ref } : {}), ...(audio ? { audio } : {}), createdAt: now, bagId: event.id, bagAt: event.created_at, published: true, bag: settings }
      // The fresh copy takes the marked row's place; the old id is done with here.
      await commitRows(owner, rowsOf(owner).map((m) => (m.eventId === eventId ? fresh : m.lookupId === d.lookupId && inItsBag(m) ? { ...m, bagId: event.id, bagAt: event.created_at, published: true, bag: settings } : m)))
      const deleted = { ...get().deleted, [eventId]: true as const }
      set({ deleted })
      saveDeleted(deleted)
      // A key you hold is held as this copy, in the place of the version
      // before: one ITEMS row per keypair (review of #595); one you never
      // picked up stays not held (arkinox, 2026-11-06). In the items of the
      // identity that hid it, whoever is signed in by now (review of #599).
      if (d.key) void useInventory.getState().holdAgain(inner, d.key, { lookupId: d.lookupId, bagId: event.id, at: d.at, plane: d.plane, height: d.height }, owner)
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  async function broadcastBag(lookupId: string): Promise<boolean> {
    if (get().broadcasting) return false
    // Asked for by this identity: its rows only, and nothing sent as the next
    // one if they switch on the way (#559 follow-up).
    const owner = cyber().identity.pubkey
    const switched = (): boolean => {
      if (cyber().identity.pubkey === owner) return false
      set({ broadcasting: null, broadcastError: SWITCHED, broadcastFailed: lookupId })
      return true
    }
    for (const d of rowsOf(owner).filter((m) => m.lookupId === lookupId && m.putBack)) {
      if (!(await putBackNow(d.eventId, owner))) { set({ broadcastError: PUT_BACK_PENDING, broadcastFailed: lookupId }); return false }
    }
    if (switched()) return false
    const items = rowsOf(owner).filter((d) => d.lookupId === lookupId)
    if (items.length === 0) return false
    // A door must never go out before its room: it would open onto nothing.
    const doorIds = new Set(items.filter((d) => d.chest?.door !== undefined).map((d) => d.eventId))
    const rooms = new Set(rowsOf(owner).filter((d) => d.room && doorIds.has(d.room.doorId) && !d.published).map((d) => d.lookupId))
    for (const room of rooms) if (switched() || !(await broadcastBag(room))) return false
    if (switched()) return false
    set({ broadcasting: lookupId, broadcastError: null, broadcastFailed: null })
    try {
      const key = hexToBytes(items[0].keyHex)
      const existing = await gatherInners(lookupId, key, true, items[0].height, owner)
      // Objects hidden by reference go out before the bag that names them,
      // and so do the authors' objects a LIVE LINK names: a finder looks
      // them up on the relays the bag goes to.
      const me = owner
      const hinted = new Map<string, Reference>()
      const rehinted = new Map<string, Reference>()
      // A sealed entry goes out before the bag that names it too (spec §7.6
      // Writing), and its reference names a relay that took it.
      for (const d of items) {
        if (d.ref || !d.sealedRef || !d.sealedEvent || d.sealedEvent.pubkey !== me) continue
        const took = await republish(d.sealedEvent)
        if (!took) {
          set({ broadcasting: null, broadcastError: 'No relay took an entry this bag names. Try again when one is reachable.', broadcastFailed: lookupId })
          return false
        }
        // An empty hint stays empty (sealHint); one an older build wrote names a relay that took it now.
        if (d.sealedRef[2] && d.sealedRef[2] !== took) rehinted.set(d.eventId, [d.sealedRef[0], d.sealedRef[1], took, ...d.sealedRef.slice(3)])
      }
      // A seed planted while LOCAL kept its DNA here: it goes out before the
      // bag, or no finder could grow the seed (DECK-0008 §8.2). A DNA this
      // device does not have was on the relays already.
      const sentDnas = new Set<string>()
      for (const d of items) {
        const seed = d.type === 'seed' && d.inner ? seedItemOf(d.inner) : null
        const dnaId = seed?.dnaId
        // Each DNA once; one another author planted from is theirs to publish, and was public when planted.
        if (!dnaId || sentDnas.has(dnaId)) continue
        sentDnas.add(dnaId)
        const v = await dnaResolver.resolve(dnaId)
        if (v.state === 'ok' && v.author !== owner) continue
        if (v.state !== 'ok' && v.state !== 'mixed') continue
        const took = await republish(v.event)
        if (!took) {
          set({ broadcasting: null, broadcastError: 'No relay took the DNA a seed in this bag plants. Try again when one is reachable.', broadcastFailed: lookupId })
          return false
        }
      }
      for (const d of items) {
        if (!d.ref) continue
        const foreign = d.inner.pubkey !== me
        if (foreign && (isProtected({ event: d.inner }) || await authorDeleted({ pubkey: d.inner.pubkey, address: d.ref[1], id: d.inner.id, createdAt: d.inner.created_at }))) {
          set({ broadcasting: null, broadcastError: isProtected({ event: d.inner }) ? LINK_PROTECTED : LINK_DELETED, broadcastFailed: lookupId })
          return false
        }
        // A bag naming an object no relay holds would be a permanent hole
        // for everyone, carried forward by every later rewrite. Stop here.
        const took = await republish(referenced(d.inner))
        if (!took) {
          set({ broadcasting: null, broadcastError: 'No relay took a shard this bag names. Try again when one is reachable.', broadcastFailed: lookupId })
          return false
        }
        // A LIVE LINK hidden while LOCAL named your first relay; now it names one that took the object.
        if (d.ref[0] === 'a' && d.ref[2] !== took) hinted.set(d.eventId, [d.ref[0], d.ref[1], took, ...d.ref.slice(3)] as Reference)
      }
      if (hinted.size > 0 || rehinted.size > 0) void commitRows(owner, rowsOf(owner).map((d) => (hinted.has(d.eventId) ? { ...d, ref: hinted.get(d.eventId) } : rehinted.has(d.eventId) ? { ...d, sealedRef: rehinted.get(d.eventId) } : d)))
      for (const [id, ref] of rehinted) { const x = sealedByItem.get(id); if (x) sealedByItem.set(id, { ...x, ref }) }
      // Not what the read above found gone from this bag (goneFrom): never written back.
      const gone = new Set(rowsOf(owner).filter((d) => !inItsBag(d)).map((d) => d.eventId))
      const fresh = items.filter((d) => !gone.has(d.eventId)).map((d) => (hinted.has(d.eventId) ? { ...d, ref: hinted.get(d.eventId) } : rehinted.has(d.eventId) ? { ...d, sealedRef: rehinted.get(d.eventId) } : d))
      // The re-hinted entries replace the bag's older ones for the same placement.
      const keep = existing.entries.filter((e) => !fresh.some((d) => (d.ref && entryKey(e) === entryKey(d.ref)) || (d.sealedRef && entryKey(e) === entryKey(d.sealedRef))))
      const allInners = mergeEntries(keep, fresh.map(entryOf))
      const settings = existing.settings ?? DEFAULT_BAG_SETTINGS
      const { event, published } = await publishBag(allInners, key, lookupId, items[0].height, true, settings, { at: positionOf(items[0]), plane: items[0].plane }, undefined, existing.entries, owner)
      if (!published) {
        set({ broadcasting: null, broadcastError: 'No relay took the bag. Try again when one is reachable.', broadcastFailed: lookupId })
        return false
      }
      const relays = relaySet()
      set({ broadcasting: null })
      void commitRows(owner, rowsOf(owner).map((d) => (d.lookupId === lookupId ? { ...d, bagId: event.id, bagAt: event.created_at, published: true, relays, bag: settings } : d)))
      return true
    } catch (err) {
      set({ broadcasting: null, broadcastError: err instanceof Error ? err.message : String(err), broadcastFailed: lookupId })
      return false
    }
  }

  return {
    pending: null,
    chestBack: null,
    workshopBack: null,
    takeWorkshopBack: () => {
      const id = get().workshopBack
      if (id !== null) set({ workshopBack: null })
      return id
    },
    takeChestBack: () => {
      const draft = get().chestBack
      if (draft) set({ chestBack: null })
      return draft
    },
    deployHeight: 0,
    deployHeightAuto: false,
    deployUnit: 0,
    deployUp: false,
    deploySpin: 0,
    deployTurn: [0, 0, 0],
    deployFollow: false,
    deployConstrain: CONSTRAIN_DEFAULT,
    deployLink: false,
    deployBag: DEFAULT_BAG_SETTINGS,
    deployBagFrom: null,
    deployStatus: 'idle',
    placedLast: null,
    placeAgain: () => {
      const s = get()
      const last = s.placedLast
      if (!last || s.pending || s.deployStatus === 'working' || againName(s) === null) return false
      // The bag controls start at the defaults and are seeded from the bag
      // under the cursor, as for any new deploy: they are that bag's.
      set({ pending: last.pending, ...last.settings, deployTurn: [...last.settings.deployTurn] as Turns, deployBag: DEFAULT_BAG_SETTINGS, deployBagFrom: null, deployStatus: 'idle', deployError: null, deployNote: null, deployAsk: null })
      cyber().setBuildStep(last.step)
      return true
    },
    deployNote: null,
    deployMining: false,
    deployAsk: null,
    deployError: null,
    deployLeaveOut: [],
    setDeployLeaveOut: (room) => set({ deployLeaveOut: room === null ? [] : get().deployLeaveOut.includes(room) ? get().deployLeaveOut : [...get().deployLeaveOut, room] }),
    deployRoomSnap: null,
    deploySealMove: false,
    setDeploySealMove: (on) => set({ deploySealMove: on }),
    sealingRoom: null,
    deployInto: null,
    deployDoorHeight: null,
    setDeployDoorHeight: (h) => set({ deployDoorHeight: h }),
    // Filled in by followIdentity below, once useCyberspace has loaded.
    mine: NOT_READ_YET,
    discovered: {},
    curated: null,
    deleted: loadDeleted(),
    deletedBags: loadDeletedBags(),
    scanning: false,
    broadcasting: null,
    broadcastError: null,
    broadcastFailed: null,
    selectedSecret: null,
    nearbyOpen: false,
    nearbyReturn: null,
    setNearbyOpen: (open) => set({ nearbyOpen: open }),
    setNearbyReturn: (r) => set({ nearbyReturn: r }),

    // A new deploy starts at the shard's own size, so the last deploy's choice
    // never carries silently into this one. Placing the same thing again is
    // `placedLast`'s, which carries everything on purpose.
    startDeployShard: (shardId, from) => set({
      pending: { type: 'shard', shardId, ...(from ? { from } : {}) },
      deployLink: false,
      deployHeightAuto: true,
      deployUnit: useWorkshop.getState().shards.find((s) => s.id === shardId)?.unit ?? 0,
      // The shard's own WALK setting, as its own size.
      deployConstrain: constrainOfId(shardId),
      // Flat, aimed north, the camera not driving: the last deploy's pose no
      // more carries into this one than its size does.
      deployUp: false,
      deploySpin: 0,
      deployTurn: [0, 0, 0],
      deployFollow: false,
      // The bag settings start fresh too; the deploy bar seeds them from your
      // bag in the region under the cursor, if there is one.
      deployBag: DEFAULT_BAG_SETTINGS,
      deployBagFrom: null,
      deployStatus: 'idle',
      deployError: null,
    }),
    // A move starts exactly as the shard stands: its height (held, not
    // fitted, so the shard stays in its bag and keeps its comments unless
    // you change it), its size, its pose and its bag's settings.
    startEditShard: (eventId) => {
      const d = get().mine.find((m) => m.eventId === eventId)
      if (!d?.shard || !editable(d, cyber().identity.pubkey) || get().deployStatus === 'working') return
      set({
        pending: { type: 'shard', shardId: eventId, edit: { eventId } },
        deployLink: false,
        deployHeight: d.height,
        // Its own height, chosen: a room it lands in stands in for it until it leaves.
        deployRoomSnap: null,
        deployHeightAuto: false,
        deployUnit: d.shard.unit,
        deployConstrain: authoredConstrainOf(d.shard),
        deployUp: d.shard.up ?? false,
        deploySpin: d.shard.spin ?? 0,
        deployTurn: [0, 0, 0],
        deployFollow: false,
        deployBag: { ...DEFAULT_BAG_SETTINGS, ...(d.bag ?? {}) },
        deployBagFrom: ownBagIn(get().mine, regionOf(positionOf(d), d.plane, d.height)),
        deployStatus: 'idle',
        deployError: null,
        deployNote: null,
        deployAsk: null,
      })
    },
    startDeployObject: (object) => set({
      pending: { type: 'shard', shardId: object.address, object },
      // A copy, as B1 rules; LIVE LINK is the deploy bar's choice.
      deployLink: false,
      deployHeightAuto: true,
      deployUnit: object.shard.unit,
      deployConstrain: authoredConstrainOf(object.shard),
      // The pose its author published goes with the copy (DECK-0003 §1.7);
      // the height decides whether the snap is offered (setDeployHeight).
      deployUp: object.shard.up ?? false,
      deploySpin: object.shard.spin ?? 0,
      deployTurn: [0, 0, 0],
      deployFollow: false,
      deployBag: DEFAULT_BAG_SETTINGS,
      deployBagFrom: null,
      deployStatus: 'idle',
      deployError: null,
    }),
    startDeployMessage: (text) => set({ pending: { type: 'message', text }, ...freshDeploy }),
    startDeployKey: (key) => set({ pending: { type: 'key', key }, ...freshDeploy }),
    // Its height fits the largest bloom its scale allows (DeployBar seedReach), until + or - is pressed.
    startDeploySeed: (seed) => set({ pending: { type: 'seed', seed }, ...freshDeploy, deployHeightAuto: true }),
    setDeployFade: (fade) => {
      const p = get().pending
      if (p?.type !== 'audio') return
      const { fade: _drop, ...rest } = p.audio
      void _drop
      set({ pending: { ...p, audio: fade === undefined ? rest : { ...rest, fade } } })
    },
    startDeployAudio: (audio, opts) => set({ pending: { type: 'audio', audio, ...(opts?.reseal ? { reseal: true as const } : {}), ...(opts?.server ? { server: opts.server } : {}) }, ...freshDeploy }),
    // With shards aimed inside, the height starts at the fit that holds them
    // all (DeployBar, lib/deployFit.ts fitHeightAll) and follows the cursor
    // until + or - is pressed, as a shard's own height does.
    // A chest wears TREASURE until the model row picks another, at the
    // model's own size and WALK setting, as a shard starts.
    startDeployChest: (draft) => set({ pending: { type: 'chest', ...draft, look: DEFAULT_CHEST_LOOK }, ...freshDeploy, ...lookStart(DEFAULT_CHEST_LOOK), deployHeightAuto: true }),
    startPlaceChest: (draft) => {
      if (get().deployStatus === 'working') return
      const d: ChestDraft = draft ?? { name: '', lock: null, requires: '', contents: [] }
      set({ pending: { type: 'chest', name: d.name, lock: d.lock, requires: d.requires, contents: d.contents, look: DEFAULT_CHEST_LOOK }, ...freshDeploy, ...lookStart(DEFAULT_CHEST_LOOK), deployHeightAuto: true, deployNote: null, deployAsk: null })
    },
    startPlaceDoor: () => {
      if (get().deployStatus === 'working') return
      set({ pending: { type: 'chest', door: true, name: '', lock: null, requires: '', contents: [], look: DEFAULT_DOOR_LOOK }, ...freshDeploy, ...lookStart(DEFAULT_DOOR_LOOK), deployHeightAuto: true, deployDoorHeight: null, deployNote: null, deployAsk: null })
    },
    placeChest: () => {
      const p = get().pending
      if (!placingChest(p) || p?.type !== 'chest') return
      // At the height of the room it joins, if it joins one (syncRoomSnap).
      get().syncRoomSnap()
      // Where it lands, fixed now: the deploy point of the build cursor at the bar's height (deploy, below).
      const { position, plane } = buildCursorOf(cyber())
      set({ pending: { ...p, spot: { at: deployPoint(position, buildStepOf(cyber()), get().deployHeight), plane } }, deployError: null })
    },
    unplaceChest: (draft) => {
      const p = get().pending
      if (p?.type !== 'chest' || !p.spot || get().deployStatus === 'working') return
      const { spot: _was, ...rest } = p
      void _was
      set({ pending: { ...rest, ...(draft ?? {}) }, deployError: null, deployAsk: null })
    },
    keepChestDraft: (draft) => {
      const p = get().pending
      // Not while it is being sealed: the deploy knows what it is finishing by
      // this very object, and a new one would leave it working for good.
      if (p?.type !== 'chest' || !p.spot || p.move || get().deployStatus === 'working') return
      set({ pending: { ...p, ...draft } })
    },
    sealPlacedChest: async (draft) => {
      const p = get().pending
      if (p?.type !== 'chest' || !p.spot || get().deployStatus === 'working') return
      set({ pending: { ...p, ...draft } })
      await get().deploy()
    },
    startMoveChest: (eventId) => {
      const d = get().mine.find((m) => m.eventId === eventId)
      if (!d?.chest || d.type !== 'chest' || d.inner.pubkey !== cyber().identity.pubkey || get().deployStatus === 'working') return
      // Its look as it stands, posed again from there: a chest from before
      // looks goes out wearing the built-in it was drawn as.
      const worn = lookOf({ type: 'chest', event: d.inner })
      const door = d.chest.door !== undefined
      // A look this client will not read goes as it is, raw: reading it as "no look" would swap it for the built-in.
      const own = lookTagsOf(d.chest.look, d.inner.pubkey)
      const unread = !!d.chest.look && ((!own.closed && d.chest.look.some((t) => t.length === 2)) || (!own.open && d.chest.look.some((t) => t.length === 3 && t[2] === 'open')))
      const look: LookChoice = unread ? { from: 'kept', tags: d.chest.look! } : d.chest.look && worn ? { from: 'model', closed: worn.closed, open: worn.open } : door ? DEFAULT_DOOR_LOOK : DEFAULT_CHEST_LOOK
      const model = lookModelOf(look)
      set({
        pending: { type: 'chest', name: d.chest.name, lock: { pubkey: d.chest.lockPubkey, label: d.chest.requires || 'its lock' }, requires: d.chest.requires, contents: [], look, move: { eventId }, ...(door ? { door: true as const } : {}) },
        ...freshDeploy,
        deployHeight: d.height,
        // Its own height, chosen: a room it lands in stands in for it until it leaves.
        deployRoomSnap: null,
        deployHeightAuto: false,
        deployUnit: model?.unit ?? 0,
        deployConstrain: model ? authoredConstrainOf(model) : CONSTRAIN_DEFAULT,
        deployBag: { ...DEFAULT_BAG_SETTINGS, ...(d.bag ?? {}) },
        deployBagFrom: ownBagIn(get().mine, regionOf(positionOf(d), d.plane, d.height)),
        deployNote: null,
        deployAsk: null,
      })
    },
    startMoveItem: (eventId) => {
      const d = get().mine.find((m) => m.eventId === eventId)
      if (!d || d.type === 'shard' || d.type === 'chest' || !movable(d, cyber().identity.pubkey) || get().deployStatus === 'working') return
      const move = { eventId }
      const pending: DeployPending | null = d.type === 'key' && d.key ? { type: 'key', key: d.key, move }
        : d.type === 'message' && d.text !== undefined ? { type: 'message', text: d.text, move }
          : d.type === 'audio' && d.audio ? { type: 'audio', audio: d.audio, move }
            : null
      if (!pending) return
      set({
        pending,
        ...freshDeploy,
        deployHeight: d.height,
        // Its own height, chosen: a room it lands in stands in for it until it leaves.
        deployRoomSnap: null,
        deployBag: { ...DEFAULT_BAG_SETTINGS, ...(d.bag ?? {}) },
        deployBagFrom: ownBagIn(get().mine, regionOf(positionOf(d), d.plane, d.height)),
        deployNote: null,
        deployAsk: null,
      })
    },
    placeFromItems: (id) => {
      const item = useInventory.getState().items[id]
      if (!item) return 'That is no longer in your ITEMS.'
      const pending = placeCopyOf(item, cyber().identity.pubkey)
      if (typeof pending === 'string') return pending
      if (copyLinedUp(get())) get().cancelDeploy()
      if (get().pending || get().deployStatus === 'working') return 'Finish or cancel what is lined up first.'
      set({ pending, ...freshDeploy, deployNote: null, deployAsk: null })
      return null
    },
    hideAgain: async (eventId) => {
      const cs = cyber()
      const owner = cs.identity.pubkey
      const d = rowsOf(owner).find((m) => m.eventId === eventId)
      if (!d || d.goneFrom === undefined) return null
      if (!againHideable(d, rowsOf(owner))) return d.ref ? HIDE_AGAIN_REF : HIDE_AGAIN_NO_DOOR
      // One bag rewrite at a time beside a hide: PLACE waits for this one (holdBags).
      if (get().deployStatus === 'working' || bagWork) return HIDE_AGAIN_BUSY
      return holdBags(() => hideCopy(d, owner))
    },
    forgetRow: (eventId) => {
      const owner = cyber().identity.pubkey
      const d = rowsOf(owner).find((m) => m.eventId === eventId && m.goneFrom !== undefined)
      if (!d) return null
      const loss = rowLoss(d, rowsOf(owner), useInventory.getState().items, owner)
      set({ lostKeys: loss?.keys ?? null })
      if (loss) return loss.why
      void commitRows(owner, rowsOf(owner).filter((m) => m.eventId !== eventId))
      return null
    },
    lostKeys: null,
    archiveLost: () => {
      for (const k of get().lostKeys ?? []) useInventory.getState().archiveMade(k.event, k.key, k.place)
      set({ lostKeys: null })
    },
    chestEntries: async (eventId) => {
      const d = get().mine.find((m) => m.eventId === eventId)
      if (!d?.chest) return 'Only the chest’s hider can change what is inside it, from the device that hid it.'
      if (d.sealed) return d.sealed
      const cs = cyber()
      const opener = openerFor(d.chest, hiderKeys(useInventory.getState().items, get().mine, cs.identity.pubkey), cs.identity.pubkey, lookupLock)
      if (!opener) return 'Opening the chest needs the key it is sealed to, which this device does not hold.'
      try {
        return opener.by === 'key' ? openWithSecret(d.chest, opener.key.secretHex) : await openWithSigner(d.chest, cs.decryptSealed)
      } catch (err) {
        return `The chest did not open: ${err instanceof Error ? err.message : String(err)}`
      }
    },
    resealChest: async (eventId, draft) => {
      const d = get().mine.find((m) => m.eventId === eventId)
      if (!d?.chest || d.inner.pubkey !== cyber().identity.pubkey) return 'Only the chest’s hider can change it.'
      if (!draft.name.trim()) return 'Name the chest.'
      if (draft.contents.length === 0) return 'Put something in it first.'
      // A reseal replaces everything inside. Nothing kept in the draft, and nothing
      // kept on this device: unless this device can read what is there, that
      // would wipe it for good.
      if (!d.sealed && !draft.contents.some((c) => c.kind === 'sealed')) {
        const inside = await get().chestEntries(eventId)
        if (typeof inside === 'string') return inside
      }
      // An EDIT or ADD that leaves out the last copy of a key forged inside it,
      // while something of yours is sealed to that key, is refused (keysLost),
      // with ARCHIVE offered. What was inside is the kept copy, else what opens.
      const before = d.sealed ?? (await get().chestEntries(eventId))
      if (Array.isArray(before)) {
        const keptSealed = draft.contents.flatMap((c) => (c.kind === 'sealed' ? [c.entry] : []))
        const forged = new Set(draft.contents.flatMap((c) => (c.kind === 'key' ? [c.key.itemPubkey] : [])))
        const me = cyber().identity.pubkey
        const loss = keysLost(keysOfRow({ ...d, key: undefined, sealed: before }, me), get().mine.map((m) => (m.eventId === eventId ? { ...m, sealed: keptSealed } : m)), useInventory.getState().items, me, forged)
        set({ lostKeys: loss?.keys ?? null })
        if (loss) return loss.why
      }
      try {
        const createdAt = Math.floor(Date.now() / 1000)
        const sealed = await sealChest(draft, positionOf(d), d.plane, createdAt)
        // Its look, and everything else it carried, stay as they were.
        await replaceChest(d, { ...sealed.chest, ...(d.chest.look ? { look: d.chest.look } : {}) }, sealed.entries)
        // A key forged inside it is not held until it is taken out (arkinox, 2026-11-06).
        return null
      } catch (err) {
        return err instanceof Error ? err.message : String(err)
      }
    },
    sealIntoRoom: async (doorId, eventIds) => {
      const cs = cyber()
      const me = cs.identity.pubkey
      const door = get().mine.find((d) => d.eventId === doorId)
      const secret = door ? doorSecret(me, doorId) : null
      if (!door || !secret) return 'Sealing into a room needs its door secret. Open the door first.'
      const rows = hereInRoom(get().mine, door).filter((d) => eventIds.includes(d.eventId))
      if (rows.length === 0) return 'Nothing here to seal.'
      // One bag rewrite at a time beside a hide or another SEAL (holdBags), as HIDE AGAIN.
      if (get().deployStatus === 'working' || bagWork || get().sealingRoom) return SEAL_BUSY
      set({ sealingRoom: doorId })
      try {
        return await holdBags(() => sealRows(door, secret, rows, me))
      } finally {
        if (get().sealingRoom === doorId) set({ sealingRoom: null })
      }
    },
    resealDoor: async (eventId, draft) => {
      const cs = cyber()
      const me = cs.identity.pubkey
      const d = get().mine.find((m) => m.eventId === eventId)
      if (!d?.chest || d.chest.door === undefined || d.inner.pubkey !== me) return 'Only the door\u2019s hider can change it.'
      if (!draft.name.trim()) return 'Name the door.'
      const named = { ...d.chest, name: draft.name.trim(), requires: draft.requires.trim() }
      try {
        // The same lock: the same seal, a new name and label. Nothing behind it changes.
        if (draft.lock.pubkey === d.chest.lockPubkey && !doorRowsOfRoom(d).some((x) => x.rotating)) {
          const secret = doorSecret(me, eventId)
          const row = await replaceChest(d, named, undefined, secret ? (id) => commitDoorSecret(me, id, secret) : undefined)
          retargetRoom(eventId, row.eventId, me)
          return null
        }
        // A new lock rotates the room key (R10, §3.7.7). In the spec's order, so
        // nothing can be lost on the way: every door and bag is signed first, and
        // the new secret kept, before anything goes out; then the new room bag;
        // then the doors; and only when all of that has landed, the old bag goes.
        // Whoever opened it before keeps what they read, not what comes after.
        const secret = doorSecret(me, eventId)
        if (!secret) return 'Changing the lock needs the door secret. Open the door first.'
        const doorRows = doorRowsOfRoom(d)
        // A rotation that did not finish is finished by this one: its rooms go too.
        const owed = doorRows.flatMap((door) => door.rotating ?? [])
        const live = owed.length > 0 || doorRows.some((door) => get().mine.some((m) => m.lookupId === door.lookupId && m.published))
        const oldRoom = { entries: [] as BagEntry[] }
        const synced = await syncRoomRows(d, secret, live, me, oldRoom)
        if (typeof synced === 'string') return synced
        const place = await doorLocation(d)
        const oldKey = roomKey(place.key, hexToBytes(secret))
        const oldLookup = roomLookupIn(oldKey, d.plane)
        const nextSecret = newDoorSecret()
        const nextKey = roomKey(place.key, hexToBytes(nextSecret))
        const nextLookup = roomLookupIn(nextKey, d.plane)
        const signed = new Map<string, { row: MyDeployment; next: ChestItem; inner: NostrEvent; createdAt: number }>()
        for (const door of doorRows) {
          const lockPubkey = door.eventId === eventId ? draft.lock.pubkey : door.chest!.lockPubkey
          const sealed = sealEntries(roomEntries(nextSecret) as BagEntry[], lockPubkey)
          const next = { ...(door.eventId === eventId ? named : door.chest!), lockPubkey, senderPubkey: sealed.senderPubkey, payload: sealed.payload }
          const createdAt = Math.max(Math.floor(Date.now() / 1000), door.createdAt + 1)
          // Before each door's signature: a switch during the last one stops it here (review of #599).
          if (cyber().identity.pubkey !== me) throw new Error(SWITCHED)
          signed.set(door.eventId, { row: door, next, createdAt, inner: await cs.signEvent(chestInnerTemplate(next, positionOf(door), door.plane, createdAt)) })
        }
        const editedId = signed.get(eventId)!.inner.id
        // The old room's sealed entries, to retract once the old room bag is
        // (§3.7.7 step 4: "the events it referenced"): every one of yours the
        // relays' newest old room bag names, which syncRoomRows read, an item
        // deleted on this device but still named there among them; and those
        // the rows name, for what never reached a relay.
        const oldSealed: Reference[] = [...oldRoom.entries, ...synced.flatMap((r) => (r.sealedRef && !r.ref ? [r.sealedRef] : []))].filter((e): e is Reference => isReference(e) && sealedRefParts(e)?.pubkey === me)
        const stage = synced.length > 0 ? await stageMove(synced, { key: nextKey, lookupId: nextLookup, height: place.height, room: { doorId: editedId } }, true, me) : null
        const bags = new Map<string, { event: NostrEvent; settings: BagSettings; publicly: boolean }>()
        for (const lookupId of new Set(doorRows.map((door) => door.lookupId))) {
          const first = doorRows.find((door) => door.lookupId === lookupId)!
          const publicly = doorRows.some((door) => door.lookupId === lookupId && door.rotating) || get().mine.some((m) => m.lookupId === lookupId && m.published)
          const key = hexToBytes(first.keyHex)
          const gathered = await gatherInners(lookupId, key, publicly, first.height, me)
          const swap = new Map(doorRows.filter((door) => door.lookupId === lookupId).map((door) => [entryKey(entryOf(door)), signed.get(door.eventId)!.inner as BagEntry]))
          const entries = [...gathered.entries.map((e) => swap.get(entryKey(e)) ?? e), ...[...swap].filter(([k]) => !gathered.entries.some((e) => entryKey(e) === k)).map(([, v]) => v)]
          const settings = gathered.settings ?? first.bag ?? DEFAULT_BAG_SETTINGS
          bags.set(lookupId, { publicly, settings, event: await signBag(entries, key, lookupId, first.height, settings, { at: positionOf(first), plane: first.plane }, gathered.entries, me) })
        }
        const oldBagId = synced[0]?.bagId ?? null
        const retractions: NostrEvent[] = []
        if (live) for (const [lookupId, bagId] of new Map([...owed.map((o) => [o.lookupId, o.bagId] as const), [oldLookup, oldBagId] as const])) retractions.push(await bagRetraction(lookupId, bagId, me))
        // Everything is signed. From here a failure is a relay's. The new secret is
        // kept before anything goes out, under the doors it will open.
        // If this device cannot keep it, nothing goes out.
        for (const { inner } of signed.values()) await commitDoorSecret(me, inner.id, nextSecret)
        if (stage) await sendMove(stage)
        let landed = 0
        const out = new Set<string>()
        for (const [lookupId, bag] of bags) {
          if (!bag.publicly) { settleSealed(bag.event, true); landed++; out.add(lookupId); continue }
          const ok = await sendBag(bag.event).then((r) => r.ok, () => false)
          if (ok) { landed++; out.add(lookupId) }
          else if (landed === 0) {
            // No door has moved: the old one stands, and its room comes back as it was.
            if (stage) {
              await undoObjects(stage.objects, stage.owner)
              await retractBag(nextLookup, stage.bag.id, stage.owner)
            }
            return 'No relay took the door. Nothing has changed.'
          } else break
        }
        // The rows follow what went out.
        const doorMine = rowsOf(me).map((m): MyDeployment => {
          const was = signed.get(m.eventId)
          const bag = bags.get(m.lookupId)
          if (was && bag) {
            const { sealed: _gone, rotating: _done, ...rest } = m
            void _gone
            void _done
            const sent = out.has(m.lookupId)
            return { ...rest, eventId: was.inner.id, inner: was.inner, chest: was.next, createdAt: was.createdAt, bagId: bag.event.id, bagAt: bag.event.created_at, published: bag.publicly && sent, bag: bag.settings, ...(sent ? {} : { rotating: [...owed, { lookupId: oldLookup, bagId: oldBagId, doorId: m.eventId }] }) }
          }
          return bag ? { ...m, bagId: bag.event.id, bagAt: bag.event.created_at, published: bag.publicly && out.has(m.lookupId), bag: bag.settings } : m
        })
        await commitRows(me, doorMine)
        const discovered = { ...get().discovered }
        for (const [old, was] of signed) {
          const h = discovered[old]
          if (h) { delete discovered[old]; discovered[was.inner.id] = { ...h, eventId: was.inner.id, inner: was.inner, chest: was.next, createdAt: was.createdAt, bagId: bags.get(was.row.lookupId)?.event.id ?? h.bagId } }
        }
        set({ discovered, selectedSecret: signed.get(get().selectedSecret ?? '')?.inner.id ?? get().selectedSecret })
        remember([...signed.values()].map((v) => v.inner.id))
        if (stage) await finishMove(stage)
        for (const [old, was] of signed) retargetRoom(old, was.inner.id, me)
        if (landed < bags.size) return 'One of this room\u2019s doors did not go out, and still names the old room. Nothing behind it is lost: EDIT it again when a relay is reachable.'
        // Last, and only now: the old room bag (§3.7.7 step 4), then the sealed
        // entries it named, emptied first (spec §7.6 Retracting). What moved
        // was sealed again under the new key with a fresh `d` (stageMove), so
        // nothing ties the new room to the old addresses.
        const tookRetraction = new Set<string>()
        for (const retraction of retractions) for (const url of tookOf(await publishMany(relaySet(), retraction).catch(() => ({ ok: false as const, reason: '' })))) tookRetraction.add(url)
        if (live && tookRetraction.size > 0) await retractSealedAmong(oldSealed, me, [...tookRetraction])
        return null
      } catch (err) {
        return err instanceof Error ? err.message : String(err)
      }
    },
    deleteDoor: async (eventId, contents) => {
      const me = cyber().identity.pubkey
      const d = get().mine.find((m) => m.eventId === eventId)
      if (!d?.chest || d.chest.door === undefined || d.inner.pubkey !== me) return 'Only the door\u2019s hider can remove it.'
      try {
        // One of several: only this door goes. The room stays while any other
        // door opens it (§3.7.8), and what stood behind this door now stands
        // behind that one.
        const others = doorRowsOfRoom(d).filter((m) => m.eventId !== eventId)
        if (others.length > 0) {
          await get().deleteInstance(eventId)
          // On the list of the identity that removed it, whoever is signed in by now.
          retargetRoom(eventId, others[0].eventId, me)
          // What this device knew of the room it still knows, by the door that stands.
          const known = doorSecret(me, eventId)
          if (known && !doorSecret(me, others[0].eventId)) keepDoorSecret(me, others[0].eventId, known)
          return null
        }
        const secret = doorSecret(me, eventId)
        // Without the secret the door goes and its room bag stays, readable
        // only by whoever kept the secret (§3.7.8, 4.11).
        if (!secret) { await get().deleteInstance(eventId); return null }
        const live = get().mine.some((m) => (m.lookupId === d.lookupId || m.room?.doorId === eventId) && m.published)
        const rows = await syncRoomRows(d, secret, live, me)
        if (typeof rows === 'string') return rows
        const place = await doorLocation(d)
        const key = roomKey(place.key, hexToBytes(secret))
        // A door behind this one goes the same way, room and all (§3.7.8: never a room bag no door names).
        if (contents) {
          for (const r of rows) {
            if (r.chest?.door !== undefined) {
              const why = await get().deleteDoor(r.eventId, true)
              if (why) return why
            } else await get().deleteInstance(r.eventId)
          }
        }
        else await moveEntries(rows, { key: place.key, lookupId: place.lookupId, height: place.height }, me)
        // Never a room bag no door names (§3.7.8).
        if (live || rows.some((r) => r.published)) await retractBag(roomLookupId(key), null, me)
        await get().deleteInstance(eventId)
        return null
      } catch (err) {
        return err instanceof Error ? err.message : String(err)
      }
    },
    convertToDoor: async (eventId) => {
      const cs = cyber()
      const me = cs.identity.pubkey
      const d = get().mine.find((m) => m.eventId === eventId)
      if (!d?.chest || d.type !== 'chest' || d.chest.door !== undefined || d.inner.pubkey !== me) return 'Only the chest\u2019s hider can convert it.'
      if (d.height < 1) return 'A door locks a region: this chest is hidden at height 0, so MOVE it higher first.'
      if (d.room) return 'This chest stands in a room: MOVE it out of the room first.'
      // CONVERT never loses anything: every thing in the chest, as it is, unfiltered.
      let list: unknown[]
      if (d.sealed) list = d.sealed
      else {
        const opener = openerFor(d.chest, hiderKeys(useInventory.getState().items, get().mine, me), me, lookupLock)
        if (!opener) return 'Opening the chest needs the key it is sealed to, which this device does not hold.'
        try {
          const parsed = JSON.parse(opener.by === 'key' ? plaintextWithSecret(d.chest, opener.key.secretHex) : await cs.decryptSealed(d.chest.senderPubkey, d.chest.payload)) as unknown
          if (!Array.isArray(parsed)) return 'This chest holds something this client cannot read.'
          list = parsed
        } catch (err) {
          return `The chest did not open: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      // Anything that could not stand in the room refuses the whole conversion:
      // the chest stays exactly as it was, and nothing has been signed or sent.
      const here = positionOf(d)
      const { movable, blocked } = movableIntoRoom(list, me, here, d.plane, d.height)
      if (blocked > 0) return cantMove(blocked)
      // One secret per room (§3.7.5): a door of yours already in this room hands
      // this one its secret, and what the chest held joins that room.
      const standing = ownDoors(get().mine, me).filter((o) => roomOf(o.at, o.plane, o.height) === roomOf(here, d.plane, d.height))
      if (standing.some((o) => !o.secret) || (await unseenDoorHere(here, d.plane, d.height))) return 'A door of yours already stands in this room. Open it first, and this one joins it.'
      const secret = standing[0]?.secret ?? newDoorSecret()
      const key = roomKey(hexToBytes(d.keyHex), hexToBytes(secret))
      const lookupId = roomLookupIn(key, d.plane)
      let inside = movable.map((e): BagEntry => { const { sig, ...rumor } = e.event; return sig ? e.event : rumor })
      const live = get().mine.some((m) => m.lookupId === d.lookupId && m.published)
      let bagId = ''
      let published = false
      let before: BagEntry[] = []
      // A shard from the chest that went by reference to fit the room (lib/bagFit.ts): its object, by the chest entry's id.
      const objects = new Map<string, { object: NostrEvent; ref: Reference }>()
      // The objects that went out: only these are ever taken back, and only while LIVE.
      const sentObjects: NostrEvent[] = []
      // The chest stands, so what was copied comes out: a bag this write made goes
      // (§3.7.8), and a room already there goes back to what it held.
      // The objects of shards that went by reference go once no bag names them:
      // never while a room bag that could not be put back, or retracted, still does.
      const takeBack = async (): Promise<void> => {
        const dropObjects = async (): Promise<void> => { if (live) for (const o of sentObjects) await retractObject(o).catch(() => undefined) }
        if (!published) { await dropObjects(); return }
        if (before.length === 0) { if (await retractBag(lookupId, bagId, me)) await dropObjects(); return }
        const back = await publishBag(before, key, lookupId, d.height, live, ROOM_BAG_SETTINGS, { at: here, plane: d.plane }, undefined, before, me).catch(() => null)
        if (!back?.published) return
        await commitRows(me, rowsOf(me).map((m) => (m.lookupId === lookupId ? { ...m, bagId: back.event.id, bagAt: back.event.created_at } : m)))
        await dropObjects()
      }
      try {
        if (inside.length > 0) {
          const room = await gatherInners(lookupId, key, live, d.height, me)
          before = room.entries
          // A shard of yours from the chest goes by reference when the room
          // would not hold it inline, the largest first; refused in words when
          // even that does not fit, before anything is signed.
          const fit = fitByReference(mergeEntries(room.entries, inside), inside, lookupId, d.height, ROOM_BAG_SETTINGS, { at: here, plane: d.plane }, room.entries, me)
          if (fit.refusal) return fit.refusal
          for (const e of inside) {
            const c = isReference(e) ? undefined : fit.refs.get(e.id)
            if (c) objects.set(c.key, { object: await objectFor(e as NostrEvent, c, key, Math.max(Math.floor(Date.now() / 1000), (e as NostrEvent).created_at), me), ref: c.ref })
          }
          // The objects first: a bag never names what no relay has. Each
          // reference names the relay that took its object (republish).
          if (live) {
            for (const [id, o] of objects) {
              const took = await republish(o.object)
              if (!took) {
                await takeBack()
                return 'No relay took a shard from the chest. The chest stays as it was.'
              }
              sentObjects.push(o.object)
              objects.set(id, { object: o.object, ref: [o.ref[0], o.ref[1], took, ...o.ref.slice(3)] })
            }
          }
          inside = inside.map((e) => (isReference(e) ? e : objects.get(e.id)?.ref ?? e))
          const written = await publishBag(mergeEntries(room.entries, inside), key, lookupId, d.height, live, ROOM_BAG_SETTINGS, { at: here, plane: d.plane }, undefined, room.entries, me)
            .catch(async (err: unknown) => { await takeBack(); throw err })
          bagId = written.event.id
          published = written.published
          if (live && !published) {
            await takeBack()
            return 'No relay took the room. The chest stays as it was.'
          }
          // Every entry must have reached the room bag, read back from what was
          // written: the bag writer leaves out what a chest beside it holds.
          const reached = new Set((await bagEntries(written.event, key)).map(entryKey))
          const missing = inside.filter((e) => !reached.has(entryKey(e))).length
          if (missing > 0) {
            await takeBack()
            return cantMove(missing)
          }
        }
        const sealed = sealEntries(roomEntries(secret) as BagEntry[], d.chest.lockPubkey)
        const look = builtInLookTags('door', { unit: 0, turn: [0, 0, 0], constrain: 'all' })
        // Only now does the chest go, in one rewrite with the door in its place.
        let row: MyDeployment
        try {
          row = await replaceChest(d, { ...d.chest, senderPubkey: sealed.senderPubkey, payload: sealed.payload, look, door: d.height }, undefined, (id) => commitDoorSecret(me, id, secret))
        } catch (err) {
          await takeBack()
          throw err
        }
        const keyHex = bytesToHex(key)
        const rows = movable.map((e): MyDeployment => {
          const p = eventPlace(e.event)!
          const { sig, ...rumor } = e.event
          const o = objects.get(e.id)
          if (o) return { eventId: o.object.id, inner: o.object, ref: o.ref, ...keptLineage({ inner: e.event }), type: e.body.type, shard: e.body.shard, bagId, at: storedAt(p.at), plane: d.plane, height: d.height, lookupId, keyHex, relays: relaySet(), createdAt: e.event.created_at, published, bag: ROOM_BAG_SETTINGS, room: { doorId: row.eventId } }
          return { eventId: e.id, inner: sig ? e.event : rumor, type: e.body.type, shard: e.body.shard, text: e.body.text, key: e.body.key, chest: e.body.chest, audio: e.body.audio, bagId, at: storedAt(p.at), plane: d.plane, height: d.height, lookupId, keyHex, relays: relaySet(), createdAt: e.event.created_at, published, bag: ROOM_BAG_SETTINGS, room: { doorId: row.eventId } }
        })
        // Any room bag's other rows name its newest envelope; the door's bag is this write's own.
        await commitRows(me, [...rowsOf(me).map((m) => (m.lookupId === lookupId && bagId ? { ...m, bagId, published } : m)), ...rows])
        return null
      } catch (err) {
        return err instanceof Error ? err.message : String(err)
      }
    },
    setDeployLook: (look) => {
      const p = get().pending
      if (p?.type !== 'chest' || get().deployStatus === 'working') return
      set({ pending: { ...p, look }, ...lookStart(look), deployTurn: [0, 0, 0], deployAsk: null, deployError: null })
    },
    startDeployIntoChest: (draft, contentIndex) => {
      const c = draft.contents[contentIndex]
      if (c?.kind !== 'shard') return
      set({
        pending: { type: 'shard', shardId: c.shardId, intoChest: { draft, contentIndex } },
        deployLink: false,
        deployHeightAuto: true,
        // A re-aim starts at the size it was aimed at; a first aim at the model's own.
        deployUnit: c.aimed?.unit ?? useWorkshop.getState().shards.find((s) => s.id === c.shardId)?.unit ?? 0,
        deployConstrain: c.aimed ? constrainOfSigned(c.aimed.signed) : constrainOfId(c.shardId),
        deployUp: false,
        deploySpin: 0,
        deployTurn: [0, 0, 0],
        deployFollow: false,
        deployBag: DEFAULT_BAG_SETTINGS,
        deployBagFrom: null,
        deployStatus: 'idle',
        deployError: null,
      })
    },
    setDeployBag: (patch) => set({ deployBag: { ...get().deployBag, ...patch } }),
    seedDeployBag: (bag) => {
      const from = get().deployBagFrom
      if ((bag?.region ?? null) === (from?.region ?? null)) return
      // Leaving your bag's region for one with no bag: back to the defaults,
      // so that bag's riddle never follows the cursor into a new bag.
      set({ deployBag: bag ? bag.settings : DEFAULT_BAG_SETTINGS, deployBagFrom: bag })
    },
    // Buryable up to the compute ceiling (past that the region derivation
    // throws); discovery only auto-scans to SCAN_MAX_HEIGHT, which the DeployBar
    // warns about.
    setDeployHeight: (h) => {
      const height = Math.max(0, Math.min(get().deployCeiling(), Math.round(h)))
      // Joining a room, the room's height stands: this is the height chosen,
      // which comes back when the placement leaves the room (syncRoomSnap).
      const snap = get().deployRoomSnap
      if (snap) {
        if (snap.chosen !== height) set({ deployRoomSnap: { ...snap, chosen: height } })
        return
      }
      set(heightPatch(height))
    },
    syncRoomSnap: () => {
      const s = get()
      // Hiding, the height is the one it went out at, whatever the cursor does.
      if (s.deployStatus === 'working') return
      const snap = s.deployRoomSnap
      if (!s.pending) {
        if (snap) set(leaveRoom(snap))
        return
      }
      const cs = cyber()
      // A chest placed first (R18) stands where PLACE CHEST put it. Otherwise
      // the build cursor: the deploy point at any height up to a room's is in
      // the same cube of that height as the cursor (space.ts deployPoint).
      const spot = s.pending.type === 'chest' ? s.pending.spot : undefined
      const room = autoRoomFor(s, cs.identity.pubkey, spot?.at ?? buildCursorOf(cs).position, spot?.plane ?? buildPlane(cs))
      if (room) {
        const key = roomOf(room.at, room.plane, room.height)
        if (snap?.room === key && s.deployHeight === room.height) return
        // The pose and the hint as they stood before any room: a low room drops them (heightPatch), leaving brings them back.
        const kept = snap?.kept ?? { up: s.deployUp, follow: s.deployFollow, hint: s.deployBag.hint }
        set({ deployRoomSnap: { room: key, chosen: snap?.chosen ?? s.deployHeight, kept }, ...heightPatch(room.height) })
      } else if (snap) set(leaveRoom(snap))
    },
    setDeployUnit: (unit) => set({ deployUnit: clampUnit(unit) }),
    setDeployConstrain: (c) => set({ deployConstrain: c }),
    setDeployUp: (up) => set({ deployUp: up, ...(up ? {} : { deployFollow: false }) }),
    setDeploySpin: (spin) => set({ deploySpin: wrapSpin(spin) }),
    setDeployFollow: (follow) => set({ deployFollow: follow }),
    // Linked, it is the author's object as they publish it: their size, no
    // turns, no snap. Back to a copy, the bar's own controls apply again.
    setDeployLink: (link) => {
      const object = get().pending?.type === 'shard' ? (get().pending as { object?: FeedObject }).object : undefined
      if (!object) return
      // Protected by its author (NIP-70): only they may republish it, which a
      // LIVE LINK must do, so it goes out only as a copy.
      if (link && isProtected(object)) return
      set(link
        ? { deployLink: true, deployUnit: object.shard.unit, deployTurn: [0, 0, 0], deployUp: false, deployFollow: false, deploySpin: 0, deployConstrain: authoredConstrainOf(object.shard), deployAsk: null }
        : { deployLink: false })
      // Copy on pick, while LIVE only (copyForLink).
      if (link && cyber().live) void copyForLink(object)
    },
    turnDeploy: (axis) => { const t = [...get().deployTurn] as Turns; t[axis] = (t[axis] + 1) % 4; set({ deployTurn: t }) },
    resetDeployTurn: () => set({ deployTurn: [0, 0, 0] }),
    deployCeiling: () => {
      const cs = cyber()
      return deployCeiling({ localMax: localKeyCeiling(), cloudMode: cs.cloudPrefs.mode, cloudCap: cs.cloud.limits?.max_hop_height ?? null })
    },
    cancelDeploy: (asked = false) => {
      // Working, it is not stopped, except while it waits on the bag lock having signed nothing (review of #599).
      // Or while it mines a seed's work, which has signed nothing yet either (DECK-0008 §7).
      const mining = isMining(get().pending)
      if (get().deployStatus === 'working' && !(deployWaiting !== null && deployWaiting === get().pending) && !mining) return
      deployWaiting = null
      if (mining) cancelMining()
      // A shard being aimed into a chest gives the chest back as it was: the
      // composer reopens with the draft intact and that shard as before.
      const { pending } = get()
      const chestBack = pending?.type === 'shard' && pending.intoChest ? pending.intoChest.draft : null
      // From the workshop, CANCEL goes back to the workshop (useBuilder).
      const workshopBack = asked && pending?.type === 'shard' && pending.from === 'workshop' ? pending.shardId : null
      set({ pending: null, deployStatus: 'idle', deployError: null, deployNote: null, deployMining: false, deployAsk: null, chestBack, ...(workshopBack ? { workshopBack } : {}) })
    },
    confirmDeploy: () => { set({ deployAsk: null }); void get().deploy(true) },
    declineDeploy: () => set({ deployAsk: null }),

    deploy: async (confirmed = false) => {
      // The room under the placement, joined now, whatever the subscriptions saw last.
      get().syncRoomSnap()
      const { pending, deployHeight, deployUnit, deployUp, deploySpin, deployTurn, deployConstrain, deployBag, deployBagFrom, deployLink } = get()
      // What PLACE AGAIN starts from: the height chosen, which a room's stands in for while it holds the placement.
      const chosen = chosenHeight(get())
      if (!pending) return
      // One hide at a time. Space (or a second tap) while the key is being
      // computed and the bag sealed used to start a second deploy of the same
      // thing: two signatures, and the item in the bag twice (found in
      // review, 2026-10-07).
      if (get().deployStatus === 'working') return
      const cs = cyber()
      // The center of the build cursor's cell at the zoom you are building in
      // (or of the region, for a bag smaller than a cell), where the ghost
      // showed it: lib/space.ts deployPoint (arkinox, 2026-10-01). At 2^0 that
      // is the cursor's own coordinate, as it always was. A deploy happens in
      // BUILD mode (useBuilder), so the cursor is the build cursor and the
      // plane is the one the build view shows (lib/buildCursor.ts).
      // The cell is the build STEP's when one finer than the zoom is set
      // (lib/buildCursor.ts buildStepOf, arkinox 2026-10-08).
      // A chest placed first (R18) lands where PLACE CHEST fixed it, whatever
      // the cursor did while its modal was filled.
      const built = buildCursorOf(cs)
      const spotted = pending.type === 'chest' ? pending.spot : undefined
      const plane: Plane = spotted?.plane ?? built.plane
      const at: Position = spotted?.at ?? deployPoint(built.position, buildStepOf(cs), deployHeight)
      // A copy lined up again lands nowhere new until something changes: the
      // place, or how it goes out. Exactly on top of the last one it would be
      // a second, identical item, which is a second press or a held Space.
      const spot = spotOf(at, plane, { deployHeight, deployUnit, deployUp, deploySpin, deployTurn, deployLink })
      const last = get().placedLast
      if (last && last.pending === pending && last.spot === spot) return
      const createdAt = Math.floor(Date.now() / 1000)
      if (deployBag.hint && !hintFits(deployBag.hint, deployHeight)) {
        set({ deployStatus: 'error', deployError: `A sector hint cannot contain a height ${deployHeight} region: a sector is 2^30 on a side. Turn the hint off or hide lower.` })
        return
      }

      // A shard aimed into a chest is signed, not hidden: no key is computed
      // for it, so no route and no HOSAKA ask (its height is only the cell
      // its point is centered in, as for any shard).
      const intoChest = pending.type === 'shard' ? pending.intoChest : undefined
      // EDIT: the deployment being moved. It must still be here to move.
      const editId = editingId(pending)
      let was = editId ? get().mine.find((d) => d.eventId === editId) : undefined
      if (editId && (!was?.shard || !editable(was, cs.identity.pubkey))) {
        set({ deployStatus: 'error', deployError: EDIT_GONE })
        return
      }
      // MOVE of a chest of yours: the same sealed chest, at the new place.
      const movedChest = pending.type === 'chest' && pending.move ? get().mine.find((d) => d.eventId === pending.move?.eventId && d.type === 'chest') : undefined
      if (pending.type === 'chest' && pending.move && (!movedChest?.chest || movedChest.inner.pubkey !== cs.identity.pubkey)) {
        set({ deployStatus: 'error', deployError: 'That chest is no longer among what this device hid, so there is nothing to move.' })
        return
      }
      // MOVE of a key item, a message or hidden audio of yours: the same item at the new place.
      const itemMoveId = itemMovingId(pending)
      const movedItem = itemMoveId ? get().mine.find((d) => d.eventId === itemMoveId) : undefined
      if (itemMoveId && (!movedItem || movedItem.type !== pending.type || !movable(movedItem, cs.identity.pubkey))) {
        set({ deployStatus: 'error', deployError: movedItem && !inItsBag(movedItem) ? MOVE_STALE : MOVE_GONE })
        return
      }
      // Newer than the version it replaces even within the same second, so
      // whichever reader holds both knows which one stands (worldOf).
      const movedAt = movedItem ? Math.max(createdAt, movedItem.inner.created_at + 1) : createdAt
      // A door moves only inside its own room (R7), and keeps its height.
      const movedDoorHeight = movedChest?.chest?.door
      if (movedChest && movedDoorHeight !== undefined && (deployHeight !== movedChest.height || !inRoom(positionOf(movedChest), movedDoorHeight, at) || plane !== movedChest.plane)) {
        set({ deployStatus: 'error', deployError: 'A door moves only inside its own room, at its own height.' })
        return
      }
      // A door locks a region: a height of at least 1 (§3.7.1).
      const doorHeight = placedDoorHeight(get())
      if (pending.type === 'chest' && pending.door && !pending.move && doorHeight < 1) {
        set({ deployStatus: 'error', deployError: 'A door locks a region: hide it at height 1 or more.' })
        return
      }
      // Which door's room this lands in, at exactly that door's height (R1). X left it out (R2).
      const into = sealingDoor(get(), cs.identity.pubkey, at, plane, deployHeight)
      if (into && !into.secret) {
        set({ deployStatus: 'error', deployError: `${into.name} stands here, and this device does not know its secret. OPEN it first, or leave this one out with the ×.` })
        return
      }
      // The room's key as this device already holds it: no key work, nothing bought (review of #633).
      const heldRoom = into?.secret && !intoChest ? heldRoomBag(into.eventId, into.secret) : null
      // An earlier move of it that could not be put back is put back first.
      if (was?.putBack) {
        // Working from here, so a second tap waits as for any hide.
        set({ deployStatus: 'working', deployError: null, deployNote: 'Putting the old version back' })
        const back = await putBackNow(was.eventId, cs.identity.pubkey)
        if (!back) {
          set({ deployStatus: 'error', deployNote: null, deployError: PUT_BACK_PENDING })
          return
        }
        set({ deployStatus: 'idle', deployNote: null })
        was = back
      }

      // A move of something the relays hold is checked against them first: a
      // device that missed a move made elsewhere would otherwise hide a second
      // live copy of it (a cashu token at two places). Refused, in words, when
      // its bag no longer holds it, or when no relay answers (review of #595).
      const checked = movedItem ?? (was && !was.ref ? was : undefined)
      if (checked?.goneFrom !== undefined) {
        set({ deployStatus: 'error', deployNote: null, deployError: MOVE_STALE })
        return
      }
      if (checked?.published) {
        set({ deployStatus: 'working', deployError: null, deployNote: 'Checking it is still where it was' })
        const still = await stillInItsBag(checked)
        if (still !== 'this') {
          set({ deployStatus: 'error', deployNote: null, deployError: still === 'gone' ? MOVE_STALE : MOVE_UNANSWERED })
          return
        }
        set({ deployStatus: 'idle', deployNote: null })
      }

      // Where the key comes from. Above this machine's ceiling it is HOSAKA's,
      // priced from its region key ladder (lib/deployPlan.ts regionKeyLadder),
      // and the Cloud compute panel's mode says whether to ask first.
      const inputs = { localMax: localKeyCeiling(), cloudMode: cs.cloudPrefs.mode, cloudCap: cs.cloud.limits?.max_hop_height ?? null }
      const route = deployRoute(deployHeight, inputs)
      if (route === 'cloud' && !intoChest && !heldRoom) {
        if (cs.cloudPrefs.mode === 'off' || deployHeight > deployCeiling(inputs)) {
          set({ deployStatus: 'error', deployError: `Height ${deployHeight} is past what this machine computes, and cloud compute is off.` })
          return
        }
        const quote = regionKeyQuote(deployHeight, cs.cloud.provider)
        if (!confirmed && needsAsk(cs.cloudPrefs.mode, quote?.sats ?? null, cs.cloudPrefs.autoMaxSats)) {
          set({ deployAsk: { sats: quote?.sats ?? null, seconds: quote?.seconds ?? null }, deployError: null })
          return
        }
      }

      let shard: ShardModel | undefined
      let text: string | undefined
      let key: KeyItem | undefined
      let chest: ChestItem | undefined
      let audio: AudioItem | undefined
      // Keys forged inside a chest, held by the hider once the chest is hidden.
      // What a chest holds, as sealed, kept on this device (MyDeployment `sealed`).
      let sealedInside: BagEntry[] | undefined
      // A door's secret, kept on this device from the moment it is sealed (4.11).
      let doorSecretHex: string | null = null
      let innerTemplate: EventTemplate | undefined
      // From the Shard Feed: the author's object, by reference (LIVE LINK) or
      // as a copy that credits it (DECK-0003 §3.2; ruling B1).
      const object = pending.type === 'shard' ? pending.object : undefined
      const link = !!object && deployLink
      if (pending.type === 'shard') {
        // A copy of a feed object is yours once hidden: what it carries comes
        // with it only when you signed it, and then only your keys
        // (lib/carried.ts signedTableOnly), never its publisher's.
        const model = was ? was.shard : object ? (link ? object.shard : signedTableOnly(object.shard, cs.identity.pubkey || null)) : useWorkshop.getState().shards.find((s) => s.id === pending.shardId)
        // An object of parts alone is an object (DECK-0003 §1.9 rule 13).
        if (!model || (model.vertices.length === 0 && (model.parts?.length ?? 0) === 0)) return
        // The deploy carries its own size. A unit the deploy bar changed makes
        // a copy rather than writing back to the bench, so the same shard can
        // be placed twice at two sizes and the workshop's model is untouched
        // either time; the payload `toPayload` builds takes the unit from here.
        // The pose goes out with the size, and only where there is ground to
        // stand on: dataspace, at SNAP_MIN_HEIGHT and above (lib/pose.ts).
        shard = posedForDeploy(model, link, { deployUp, deploySpin, deployTurn, deployUnit, deployConstrain }, plane, deployHeight)
        // The same round trip every reader makes, before the seal: an item the
        // format refuses would deploy, show for its author from this device,
        // and open as nothing for everyone else (a 516-vertex floor, 2026-09-24).
        const refusal = shardRefusal(shard)
        if (refusal) {
          set({ deployStatus: 'error', deployError: refusal })
          return
        }
        // A copy names what it copies: a feed object its author's address, a
        // remixed model the original it was remixed from (sno-core creditTags).
        // A move keeps every tag the old version carried, its credit among
        // them, and its identity (lib/hidden.ts editedTemplate).
        const credit: Credit | undefined = was ? undefined : object ? { address: object.address, relay: object.seen?.[0] } : creditOf(model)
        innerTemplate = shardInnerTemplate(shard, at, plane, createdAt, credit)
        if (was) innerTemplate = editedTemplate(innerTemplate, was.inner)
      } else if (pending.type === 'key') {
        if (!pending.key.name.trim()) return
        // Moved, it is the very item it was: its keypair, name and every tag.
        key = movedItem?.key ?? { ...pending.key, name: pending.key.name.trim(), about: pending.key.about.trim() }
        innerTemplate = movedItem ? movedTemplate(movedItem.inner, at, plane, movedAt) : pending.copy ? copyTemplateAt(pending.copy, at, plane, createdAt) : keyInnerTemplate(key, at, plane, createdAt)
      } else if (pending.type === 'chest') {
        // Signed and sealed inside the try below: the contents are signed by
        // the identity, which may be a remote signer, and the bar shows it.
        // A moved chest is sealed already.
        if (!movedChest && (!pending.name.trim() || (!pending.door && pending.contents.length === 0) || !pending.lock)) return
      } else if (pending.type === 'audio') {
        if (!pending.audio.url) return
        // The sphere is set at the ghost; where it really lands it is clamped to the room it has there (never out of the hide region).
        const fade = fadeAt(pending.audio.fade, at, deployHeight)
        const { fade: _old, ...rest } = pending.audio
        void _old
        audio = { ...rest, ...(fade !== undefined ? { fade } : {}), title: pending.audio.title.trim() || 'audio', about: pending.audio.about.trim() }
        // A copy's template waits for its fresh key, inside the try below.
        // Moved, it is the same file under the same key; only its sphere is
        // set again, for the room it has at the new place.
        if (movedItem) innerTemplate = movedTemplate(movedItem.inner, at, plane, movedAt, { names: ['fade'], tags: audio.fade !== undefined ? [['fade', String(Math.max(0, Math.floor(audio.fade)))]] : [] })
        else if (!pending.reseal) innerTemplate = audioInnerTemplate(audio, at, plane, createdAt)
      } else if (pending.type === 'seed') {
        // Its template is made, and its work mined, inside the try below, once its key is in hand.
        if (dnaTextRefusal(pending.seed.text) !== null || draftPrice(pending.seed) === null) return
      } else {
        text = movedItem?.text ?? pending.text.trim()
        if (!text.trim()) return
        innerTemplate = movedItem ? movedTemplate(movedItem.inner, at, plane, movedAt) : pending.copy ? copyTemplateAt(pending.copy, at, plane, createdAt) : messageInnerTemplate(text, at, plane, createdAt)
      }

      // PUT IN CHEST: the shard's inner event, built above exactly as a hide
      // would build it (its `C` the deploy point, its size, turns and pose in
      // the payload), signed and written into the chest draft at its index,
      // and the chest handed back to its composer (`chestBack`). Nothing is
      // hidden and nothing is published: the chest's own hide seals it.
      if (intoChest && shard && innerTemplate) {
        set({ deployStatus: 'working', deployError: null, deployAsk: null, deployNote: 'Signing for the chest' })
        try {
          const signed = await cs.signEvent(innerTemplate)
          const aimed: AimedShard = { signed, unit: shard.unit }
          const contents = intoChest.draft.contents.map((c, i) => (i === intoChest.contentIndex && c.kind === 'shard' ? { ...c, aimed } : c))
          const draft: ChestDraft = { ...intoChest.draft, contents }
          if (get().pending === pending) set({ pending: null, deployStatus: 'done', deployNote: null, chestBack: draft })
          else set({ chestBack: draft })
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err)
          if (get().pending === pending) set({ deployStatus: 'error', deployNote: null, deployError: reason })
        }
        return
      }

      set({ deployStatus: 'working', deployError: null, deployAsk: null })
      // Whose hide this is, fixed now. Every signature and publish below is
      // this identity's, or nothing: after any wait (the bag lock, a key
      // computed, a signer), one signed in since stops it here in words, so
      // its signer never sees a request of this one's (review of #599).
      const owner = cs.identity.pubkey
      const still = (): void => { if (cyber().identity.pubkey !== owner) throw new Error(SWITCHED) }
      const signAsOwner = (t: EventTemplate, patienceMs?: number): Promise<NostrEvent> => { still(); return cs.signEvent(t, patienceMs) }
      try {
        // A HIDE AGAIN or BROADCAST rewriting a bag: this waits for it before
        // reading any bag, so neither write drops what the other added. While
        // this one works, neither starts (holdBags). CANCEL works while it waits.
        if (bagWork) {
          set({ deployNote: BAG_WAIT_NOTE })
          deployWaiting = pending
          try {
            while (bagWork) await bagWork.catch(() => undefined)
          } finally {
            if (deployWaiting === pending) deployWaiting = null
          }
          // Cancelled while it waited: nothing was signed, and the bar is someone else's now.
          if (get().pending !== pending) return
          set({ deployNote: null })
        }
        still()
        if (pending.type === 'chest') {
          set({ deployNote: pending.door ? 'Sealing the door' : 'Signing and sealing the chest' })
          // What it wears, posed by the bar (DECK-0004 §3.6), before anything is sealed.
          const look = lookTagsFor(pending.look ?? DEFAULT_CHEST_LOOK, { unit: deployUnit, turn: deployTurn, constrain: deployConstrain })
          if (movedChest?.chest) {
            // Moved: its seal and what it holds are untouched; only its place and look change.
            chest = { ...movedChest.chest, look }
            sealedInside = movedChest.sealed
          } else if (pending.door) {
            // One secret per room (§3.7.5): a door of yours already in this
            // room hands this one its secret, and this one joins the room
            // (R5). One this device has no secret for cannot be joined here:
            // two secrets would be two rooms at one height, which the spec
            // forbids, so it is opened first.
            const room = roomOf(at, plane, doorHeight)
            const standing = ownDoors(get().mine, cs.identity.pubkey).filter((d) => roomOf(d.at, d.plane, d.height) === room)
            // Every door of the room: one this device has no secret for may have rotated since, and a sibling's secret would be the old room's.
            if (standing.some((d) => !d.secret) || (await unseenDoorHere(at, plane, doorHeight))) throw new Error('A door of yours already stands in this room. Open it first, and this one joins it.')
            doorSecretHex = standing[0]?.secret ?? newDoorSecret()
            const sealed = sealEntries(roomEntries(doorSecretHex) as BagEntry[], pending.lock!.pubkey)
            chest = { name: pending.name.trim(), lockPubkey: pending.lock!.pubkey, senderPubkey: sealed.senderPubkey, requires: pending.requires.trim(), payload: sealed.payload, look, door: doorHeight }
          } else {
            const sealed = await sealChest(pending, at, plane, createdAt, owner)
            chest = { ...sealed.chest, look }
            sealedInside = sealed.entries
          }
          innerTemplate = chestInnerTemplate(chest, at, plane, createdAt)
        }
        if (pending.type === 'audio' && pending.reseal && audio) {
          // PLACE AGAIN's copy: its own key, its own ciphertext (repeatable).
          set({ deployNote: 'Encrypting a fresh copy of the file' })
          audio = { ...audio, ...(await resealCopy(audio, (t) => signAsOwner(t, AUDIO_SIGN_PATIENCE_MS), pending.server)) }
          innerTemplate = audioInnerTemplate(audio, at, plane, createdAt)
        }
        let rk: { key: Uint8Array; lookupId: string }
        if (heldRoom) {
          rk = heldRoom
        } else if (route === 'cloud') {
          set({ deployNote: `HOSAKA has the 2^${deployHeight} key` })
          // HOSAKA's requests are signed too.
          still()
          // Hiding has no lookup id to compare against yet: the purchase checks
          // what it can (lib/regionKeyCheck.ts) and refuses a wrong key.
          const held = await useSecrets.getState().buy(at, plane, deployHeight)
          if (!held) throw new Error(useSecrets.getState().buyError ?? 'HOSAKA could not compute the key.')
          // Never seal with a key whose lookup id is not its own (spec §7.2), whatever held it.
          if (!keyFitsLookup(held.keyHex, held.lookupId)) throw new Error(wrongKeyMessage('its lookup id is not the sha256 of its key'))
          rk = { key: hexToBytes(held.keyHex), lookupId: held.lookupId }
        } else {
          set({ deployNote: `Computing the 2^${deployHeight} key on this machine` })
          rk = await regionKeyOffThread(at, deployHeight, MAX_COMPUTE_HEIGHT)
        }
        // Into a door's room: the room key and lookup id in place of the
        // region's (DECK-0004 §3.7.2), everything else as for any bag, large
        // shards by reference sealed with the room key included.
        if (into?.secret && !heldRoom) {
          const key = roomKey(rk.key, hexToBytes(into.secret))
          rk = { key, lookupId: roomLookupIn(key, plane) }
        }
        // A seed: its DNA on the relays first when it is not there yet (free;
        // LOCAL keeps it here), then the seed at the clock block, its work
        // mined in workers at its DNA's price (DECK-0008 §7, §8.2). After the
        // key, so a key that cannot be had wastes no work. CANCEL still stops
        // it while it mines: nothing is signed until the work is done, and a
        // deploy lined up in its place stops it too (plantSeed `current`).
        let seedPrice: number | null = null
        if (pending.type === 'seed') {
          seedPrice = draftPrice(pending.seed)
          const current = (): boolean => get().pending === pending
          const planted = await plantedTemplate(pending, { at, plane, createdAt, owner, live: cs.live, sign: signAsOwner, current, note: (n) => { if (current()) set({ deployNote: n }) }, mining: (on) => { if (current()) set({ deployMining: on }) } })
          if (!current()) return
          innerTemplate = planted
          still()
        }
        set({ deployNote: 'Sealing and publishing' })
        // A move of something already on the relays goes to the relays, LOCAL
        // or not, as a DELETE does: leaving the old version up while the new
        // one stays here would show it in two places, or in the old one only.
        const live = cs.live || (was?.published ?? false) || (movedChest?.published ?? false) || (movedItem?.published ?? false)
        // The bag as it stands, read before anything is signed: whether this
        // goes inline or by reference depends on what it already holds.
        const existing = await gatherInners(rk.lookupId, rk.key, live, deployHeight, owner)
        // A move inside its own bag replaces the old entry in the same rewrite.
        const replaced = was ?? movedChest ?? movedItem
        // Its entry as the bag holds it: inline, by reference, or in a sealed entry (standsFor).
        const gone = replaced && replaced.lookupId === rk.lookupId ? replaced : null
        const standing = gone ? existing.entries.filter((e) => !standsFor(e, gone)) : existing.entries
        // What you changed in the deploy bar wins; what you left as it was
        // takes the bag's current value, which may be newer than what the
        // bar showed (resolveBagSettings). The controls were seeded from
        // this region's bag only if `deployBagFrom` names this region.
        const region = regionOf(at, plane, deployHeight)
        const seeded = deployBagFrom?.region === region ? deployBagFrom.settings : DEFAULT_BAG_SETTINGS
        const settingsOf = (current: BagSettings | null): BagSettings => (into ? ROOM_BAG_SETTINGS : resolveBagSettings(deployBag, seeded, current, deployHeight))
        let settings: BagSettings = settingsOf(existing.settings)
        // A large shard is hidden by reference (spec §7.6, DECK-0003 §3.2): it
        // becomes its own kind 33331 object sealed with the same key, and the
        // bag carries only a tag naming it. A move of one reseals it under its own `d`.
        const large = pending.type === 'shard' && !!shard && !link && (was ? !!was.ref : wantsReference(shard))
        let objectD = large ? (was?.ref ? dOf(was.inner) : placementId()) : ''
        // A shard small enough to go inline goes by reference too when the bag
        // would not hold it inline (lib/bagFit.ts). Measured here, before
        // anything is signed, as signBag measures; a bag that cannot hold it
        // either way refuses it now, in signBag's words, and nothing was signed.
        let fitted = false
        if (!link && innerTemplate) {
          const planned: BagEntry = large ? ['a', `${OBJECT_KIND}:${owner}:${objectD}`, widestHint(), positionHex(at, plane)] : plannedItem(innerTemplate, owner, pending.type === 'message' || pending.type === 'audio')
          const fit = fitByReference(mergeEntries(standing, [planned]), large ? [] : [planned], rk.lookupId, deployHeight, settings, { at, plane }, existing.entries, owner)
          if (fit.refusal) throw new Error(fit.refusal)
          const c = fit.refs.get(entryKey(planned))
          if (c && pending.type === 'shard') {
            fitted = true
            objectD = c.d
            set({ deployNote: 'This bag is full: storing it by reference' })
          }
        }
        // The object goes out first, so a published bag never names something
        // the relay does not have.
        let inner: NostrEvent
        let ref: Reference | undefined
        // EDIT of a reference shard: the old object signed again, for a failed move to put back.
        let rollback: NostrEvent | undefined
        let objectSent = false
        // The shard as its own kind 33331 object, and the reference the bag
        // carries: a large one, a move of one, or one the bag cannot hold inline.
        const sealObject = async (shard: ShardModel): Promise<NostrEvent> => {
          // A move reseals the same object under its own `d`, which replaces
          // it on the relays and keeps its address, the thing its comments
          // and reactions name (arkinox, 2026-10-16).
          // A row from before a move made elsewhere would reseal the old
          // model over the moved one: refused (review of #369).
          if (was?.ref && live) {
            const still = await addressStillThis(referenced(was.inner))
            if (still !== 'this') throw new Error(still === 'newer' ? EDIT_STALE : EDIT_UNANSWERED)
          }
          // Newer than the version it replaces even within the same second
          // (a retry right after a rollback), or relays would keep that one.
          const objectAt = was ? Math.max(createdAt, was.inner.created_at + 1) : createdAt
          // An inline shard moved into a bag that cannot hold it inline is a new
          // object under a fresh `d`, published first like any new one.
          const sealed = await signAsOwner(await objectTemplate(shard, rk.key, objectD, objectAt))
          inner = sealed
          let hint = relaySet()[0] ?? ''
          if (was?.ref && live) {
            // A move publishes nothing until everything is signed: the
            // object goes out after the bag is signed (publishBag's
            // beforeSend), and the old version, signed again a second newer,
            // is what goes back if the new bag reaches no relay, so a failed
            // move never leaves the old place unreadable (review of #369).
            // Only while live: LOCAL publishes nothing, so there is nothing to put back.
            rollback = await signAsOwner({ kind: was.inner.kind, created_at: objectAt + 1, content: was.inner.content, tags: was.inner.tags })
          } else if (live) {
            // The reference names the relay that took it, as BROADCAST's does:
            // a finder is pointed only at a relay that has the object.
            still()
            const took = await republish(inner)
            if (!took) throw new Error('No relay took the shard. Try again when one is reachable.')
            hint = took
          }
          ref = referenceTo(inner, at, plane, hint)
          forgetReference(ref)
          return sealed
        }
        if (link && object) {
          // LIVE LINK: the bag names the author's own object, signed by them;
          // nothing new is signed for the item. A finder looks it up on their
          // own relays, so it must be on a relay the bag goes to: the author's
          // signed event is put on yours first, and the hint names one of
          // them. If none takes it, LIVE LINK is refused rather than hiding a
          // reference nobody can follow (review of #233). While LOCAL the bag
          // goes nowhere yet, and BROADCAST puts the object out with it.
          inner = object.event as NostrEvent
          if (isProtected(object)) throw new Error(LINK_PROTECTED)
          let hint = relaySet()[0] ?? ''
          if (live) {
            // The copy made when LIVE LINK was picked, or one made now; never
            // of what its author deleted (NIP-09). One that no relay took is
            // tried once more here before the deploy is refused.
            still()
            let copy = await copyForLink(object)
            if (!copy.hint && !copy.deleted) { linkCopies.delete(object.id); copy = await copyForLink(object) }
            if (copy.deleted) throw new Error(LINK_DELETED)
            if (!copy.hint) throw new Error(LINK_REFUSED)
            hint = copy.hint
          }
          ref = referenceTo(inner, at, plane, hint)
        } else if (pending.type === 'shard' && shard && (large || fitted)) {
          inner = await sealObject(shard)
        } else {
          if (!innerTemplate) throw new Error('Nothing to hide.')
          // A message is sealed as a rumor and never goes to the signer: a
          // signed one lifted out of the bag would show anywhere as your own
          // public note (arkinox, 2026-10-20). Hidden audio is too, or a copy
          // would show as your own file post with the key to play it
          // (DECK-0007 §3). The bag's signature vouches for both.
          // Typed as the signed event the rest of this path carries; a rumor
          // only ever goes into the bag as its entry, never out on its own.
          inner = pending.type === 'message' || pending.type === 'audio' ? rumorOf(innerTemplate, owner) as NostrEvent : await signAsOwner(innerTemplate)
          // A signer that changed the seed (its time, its tags) changed its id, and its work with it.
          if (pending.type === 'seed' && seedPrice !== null && !seedWorkHolds(inner, seedPrice)) throw new Error('Your signer changed the seed, so its work no longer holds. Nothing was hidden.')
        }
        // A door's secret reaches disk before the door goes anywhere. Its id needs the
        // signature, and a signature sends nothing. If this device cannot keep it, nothing goes out.
        if (doorSecretHex) await commitDoorSecret(cs.identity.pubkey, inner.id, doorSecretHex)
        if (movedChest && movedDoorHeight !== undefined) {
          const secret = doorSecret(cs.identity.pubkey, movedChest.eventId)
          if (secret) await commitDoorSecret(cs.identity.pubkey, inner.id, secret)
        }
        let event: NostrEvent
        let published: boolean
        try {
          // The bag again, just before it is signed: a signer that took its time,
          // or another device, may have changed it since it was read. Measured
          // with the entry as signed, so a plan made from a template never
          // passes a bag signBag would refuse: an inline shard that no longer
          // fits goes by reference now, and one that cannot fit either way is
          // refused, in words, before the bag is signed.
          const latest = live ? await gatherInners(rk.lookupId, rk.key, live, deployHeight, owner) : existing
          const now = gone ? latest.entries.filter((e) => !standsFor(e, gone)) : latest.entries
          settings = settingsOf(latest.settings)
          if (!link) {
            const entry: BagEntry = ref ?? inner
            const fit = fitByReference(mergeEntries(now, [entry]), ref ? [] : [entry], rk.lookupId, deployHeight, settings, { at, plane }, latest.entries, owner)
            if (fit.refusal) throw new Error(fit.refusal)
            const late = ref ? undefined : fit.refs.get(inner.id)
            if (late && pending.type === 'shard' && shard) {
              fitted = true
              objectD = late.d
              set({ deployNote: 'This bag is full: storing it by reference' })
              inner = await sealObject(shard)
            }
          }
          const allInners = mergeEntries(now, [ref ?? inner])
          const sendObject = was && rollback && live
            ? async () => {
              still()
              const sent = await publishMany(relaySet(), inner)
              if (!sent.ok) throw new Error('No relay took the moved shard. It stays where it was.')
              objectSent = true
            }
            : undefined
          ;({ event, published } = await publishBag(allInners, rk.key, rk.lookupId, deployHeight, live, settings, { at, plane }, sendObject, latest.entries, cs.identity.pubkey))
          // A move whose new bag no relay took has not happened: the old
          // copy stays, and is never taken down (review of #369).
          if (was && live && !published) throw new Error('No relay took the moved shard. It stays where it was.')
          if (movedChest && live && !published) throw new Error('No relay took the moved chest. It stays where it was.')
          if (movedItem && live && !published) throw new Error(`No relay took the moved ${movedNoun(movedItem.type)}. It stays where it was.`)
          // A first seal: nothing has been recorded yet, so nothing claims to be hidden.
          // Its look rides in the bag every time, so the bag is what a relay may refuse for size.
          if (pending.type === 'chest' && live && !published) throw new Error(`No relay took the bag (${JSON.stringify(event).length.toLocaleString('en-US')} bytes). Nothing was hidden.`)
        } catch (err) {
          // Put back, the row follows: the relays now hold the rollback, so it
          // is this device's version of the shard, keyed by its id as a scan
          // keys a sealed object, or every later EDIT and DELETE of it would
          // read as stale (review of #369).
          // If no relay takes it even after retries, the row keeps it to put
          // back on its next EDIT, DELETE or BROADCAST, and says so.
          if (objectSent && rollback && was) {
            const back = rollback
            if (await publishRetried(back)) rekeyTo(was.eventId, back, cs.identity.pubkey)
            else {
              keepPutBack(was.eventId, back, cs.identity.pubkey)
              throw new Error(PUT_BACK_PENDING)
            }
          }
          // The object went out but no bag names it: take it back rather than
          // leave a preview on the relay that nothing will ever clean up.
          // Only an object this deploy published; never the author's, for a LIVE LINK.
          // Never after a move: the object under that `d` is the only one.
          // A new object (a new placement, or an inline shard that went by
          // reference to fit) has nothing older under its `d`, and goes.
          if (ref && live && !link && !rollback) await retractObject(inner).catch(() => undefined)
          throw err
        }

        const item: MyDeployment = {
          // A LIVE LINK is keyed by its bag and entry (hidden.ts linkKey), as the scan keys it.
          eventId: link && ref ? linkKey(rk.lookupId, ref) : inner.id,
          inner,
          ref,
          bagId: event.id,
          bagAt: event.created_at,
          type: pending.type,
          shard,
          text,
          key,
          chest,
          audio,
          at: storedAt(at),
          plane,
          height: deployHeight,
          lookupId: rk.lookupId,
          keyHex: bytesToHex(rk.key),
          relays: relaySet(),
          createdAt,
          published,
          bag: settings,
          ...(sealedInside ? { sealed: sealedInside } : {}),
          ...(into ? { room: { doorId: into.eventId } } : {}),
          // An inline shard moved into the reference form keeps the lineage its
          // comments and reactions name (keptLineage); one already converted keeps it.
          ...(was && ref ? keptLineage(was) : {}),
        }
        // A key you hide is not held until you pick it up with TAKE, alone or
        // inside a chest (arkinox, 2026-11-06: "i want to pick it up for the
        // first time, not have it automatically"). Chests can still be sealed
        // to it: the composer lists the keys you made (lib/inventory.ts
        // sealableKeys). Moved, a key you hold says where it stands now
        // (relocate); one you never picked up stays not held.
        const place: HeldPlace = { lookupId: rk.lookupId, bagId: event.id, at: storedAt(at), plane, height: deployHeight }
        if (key && movedItem) useInventory.getState().relocate(itemLineage(movedItem.inner) ?? movedItem.eventId, place)
        // Every item now in this region's bag shares its new envelope, status and settings.
        // Onto the list of the identity that hid it, even if another has signed in meanwhile.
        const mine = [
          ...rowsOf(cs.identity.pubkey)
            // Moved inside its bag: the old version left with the rewrite above.
            .filter((d) => !(was && was.lookupId === rk.lookupId && d.eventId === was.eventId))
            .filter((d) => !(movedChest && movedChest.lookupId === rk.lookupId && d.eventId === movedChest.eventId))
            .filter((d) => !(movedItem && movedItem.lookupId === rk.lookupId && d.eventId === movedItem.eventId))
            .map((d) => (d.lookupId === rk.lookupId ? { ...d, bagId: event.id, bagAt: event.created_at, published, bag: settings } : d)),
          item,
        ]
        commitRows(cs.identity.pubkey, mine)
        // The row as kept: its lookup id must be sha256 of its key (spec
        // §7.2, rooms too), or a stranger looks where it is not. Checked on
        // what was stored, not on what was meant to be.
        const kept = rowsOf(cs.identity.pubkey).find((d) => d.eventId === item.eventId)
        if (kept && !keyFitsLookup(kept.keyHex, kept.lookupId)) {
          useToast.getState().show({ label: 'KEY CHECK FAILED', meta: `${route === 'cloud' ? `${WRONG_KEY}. ` : ''}The lookup id this was filed under is not the one its key gives, so strangers cannot find it. Tap it and TEST DISCOVERY.`, mark: 'build' })
        }
        // Placed: first in your shard lists from now. Local, and never the
        // deploy's failure; not for an identity switched to meanwhile.
        if (cyber().identity.pubkey === cs.identity.pubkey) {
          try { useShardFolders.getState().markUsed(deployedRefs(pending, cs.identity.pubkey)) } catch (err) { console.warn(`[shards] could not reorder the shard lists: ${err instanceof Error ? err.message : String(err)}`) }
        }
        // Moved to another bag: the old one is taken out of its own bag, as
        // DELETE would, except that a resealed object is the moved shard's
        // now and stays. Before the deploy counts as done, so the old one
        // never lingers after the bar says it moved.
        let moveError: string | null = null
        if (was) {
          if (was.lookupId !== rk.lookupId) {
            set({ deployNote: 'Taking it from the old place' })
            try { await get().deleteInstance(was.eventId, { keepObject: !!was.ref }) } catch (err) { moveError = err instanceof Error ? err.message : String(err) }
          } else {
            const deleted = { ...get().deleted, [was.eventId]: true as const }
            const discovered = { ...get().discovered }
            delete discovered[was.eventId]
            set({ deleted, discovered })
            saveDeleted(deleted)
          }
        }
        // A moved key item, message or hidden audio leaves its old place as a
        // moved shard does: out of its old bag only now that the new one
        // stands, so a failure up to here has moved nothing and lost nothing.
        if (movedItem) {
          if (movedItem.lookupId !== rk.lookupId) {
            set({ deployNote: 'Taking it from the old place' })
            try { await get().deleteInstance(movedItem.eventId, {}) } catch (err) { moveError = err instanceof Error ? err.message : String(err) }
          } else {
            const deleted = { ...get().deleted, [movedItem.eventId]: true as const }
            const discovered = { ...get().discovered }
            delete discovered[movedItem.eventId]
            set({ deleted, discovered })
            saveDeleted(deleted)
          }
          if (get().selectedSecret === movedItem.eventId) set({ selectedSecret: null })
        }
        // Only this deploy is finished. One lined up since (a DEPLOY from the
        // workshop while this was hiding) is a deploy of its own, and stays.
        // What repeats is lined up again in the same set, every setting left
        // as it is, so nothing in between reads the deploy as over (useBuilder
        // stands it down where the mode ends with the placement).
        if (get().pending === pending) {
          // What is recorded is what this one went out with, read when it
          // started, as its spot was; the bar itself is left as it stands.
          // The bag controls are the bag's just written here, so moving into
          // a region with no bag of yours resets them (seedDeployBag).
          const again = repeatable(pending) ? againOf(pending) : null
          const s = get()
          const placedLast: PlacedLast | null = again
            ? {
              pending: again,
              settings: { deployHeight: chosen, deployHeightAuto: s.deployHeightAuto, deployUnit, deployUp, deploySpin, deployTurn: [...deployTurn] as Turns, deployFollow: s.deployFollow, deployLink },
              step: cs.buildStep, spot, count: s.placedLast?.pending === pending ? s.placedLast.count + 1 : 1,
            }
            : s.placedLast
          // A room's settings are the room's: left out of it, the next placement starts as any other.
          const bag = again ? { deployBag: into ? DEFAULT_BAG_SETTINGS : settings, deployBagFrom: ownBagIn(s.mine, regionOf(at, plane, deployHeight)) } : {}
          set({ deployStatus: 'done', pending: again, deployNote: null, deployAsk: null, placedLast, ...bag })
        }
        // A moved door keeps its room: its secret, and what stands behind it, follow its new id.
        if (movedChest && movedDoorHeight !== undefined) {
          retargetRoom(movedChest.eventId, inner.id, cs.identity.pubkey)
        }
        // A moved chest leaves its old place the same way.
        if (movedChest) {
          if (movedChest.lookupId !== rk.lookupId) {
            try { await get().deleteInstance(movedChest.eventId) } catch (err) { moveError = err instanceof Error ? err.message : String(err) }
          } else {
            const deleted = { ...get().deleted, [movedChest.eventId]: true as const }
            set({ deleted })
            saveDeleted(deleted)
          }
          if (get().selectedSecret === movedChest.eventId) set({ selectedSecret: null })
        }
        if (moveError) useToast.getState().show({ label: 'MOVED, OLD COPY STAYED', meta: `It stands at the new place; the old one could not be taken down (${moveError}). Tap it and DELETE it.`, mark: 'build' })
      } catch (err) {
        // CANCEL while a seed's work was mining: nothing was signed or placed, and nothing failed.
        if (err instanceof MineCancelled) return
        const reason = err instanceof Error ? err.message : String(err)
        if (get().pending === pending) set({ deployStatus: 'error', deployNote: null, deployMining: false, deployError: reason })
        else useToast.getState().show({ label: 'AN EARLIER HIDE FAILED', meta: `${reason} Nothing from it was placed.`, mark: 'build' })
      }
    },

    /**
     * Send a region's bag to the relays, with everything this device has for it.
     *
     * A deploy made while LOCAL is signed and kept but never sent, and going
     * LIVE afterwards did nothing for it: the bag sat on the device with no way
     * out. This is that way out. It rebuilds the region's bag exactly as a
     * deploy does, from the relay's copy merged with every local item, so a
     * region half published from another device comes back whole rather than
     * being overwritten by this device's half.
     */
    /**
     * One bag, published now, whatever LOCAL says.
     *
     * LOCAL used to refuse this, which meant revealing one shard cost you the
     * privacy of everything else: you had to go LIVE, which drains the whole
     * movement chain onto the relay, and then remember to go back. A bag is
     * not part of that chain. It is a standalone envelope keyed to a region,
     * so sending one says nothing about where you have been, and asking for
     * it by name is a decision about that one thing.
     *
     * It only goes one way. A relay cannot unsee a bag, so there is no path
     * back from LIVE to LOCAL for something already sent.
     */
    broadcast: (lookupId) => {
      // One bag rewrite at a time beside a hide: PLACE waits for this one (holdBags).
      if (get().deployStatus === 'working' || bagWork) {
        set({ broadcastError: BROADCAST_BUSY, broadcastFailed: lookupId })
        return Promise.resolve(false)
      }
      return holdBags(() => broadcastBag(lookupId))
    },

    /**
     * One region, asked for by name. The discovery scan sweeps the cubes you
     * stand in; this asks about a region you hold the key to but are nowhere
     * near, which is what the Secrets list is for.
     */
    rescan: async (lookupId, keyHex) => {
      set({ scanning: true })
      try {
        // The canonical relay refused (no AUTH) or was not heard from: that is
        // not "nothing there". What another relay sent is opened, as before;
        // with nothing opened it reads FAILED, not NONE, and nothing is dropped.
        const asked = await queryChecked({ kinds: [HIDDEN_KIND], '#d': [lookupId] })
        if (asked.trouble && asked.events.length === 0) return -1
        // One version per bag, the newest, none its author deleted (lib/bagVersions.ts).
        const { bags: events, deletions } = await bagsToOpen(asked.events, query, get().ownDoorAddresses([lookupId]))
        // The region's height, so a bag without `H` reads at its true size: a
        // held cube's height, or your own deployment's. A box key (one height
        // per axis) is not a cube and says nothing here; `H` then decides.
        const held = useSecrets.getState().keys[lookupId]
        const cube = held && (!held.heights || (held.heights.x === held.heights.y && held.heights.y === held.heights.z)) ? held.height : undefined
        const height = cube ?? get().mine.find((d) => d.lookupId === lookupId)?.height
        const found: Hidden[] = []
        // A bag that does not open with this key is not current: what an older
        // version of it gave stays, and the rest still open (lib/hidden.ts BagUnreadable).
        const read: NostrEvent[] = []
        for (const ev of events) {
          try { found.push(...await unbagRemembered(ev, hexToBytes(keyHex), resolveReference, undefined, height)) } catch { continue }
          read.push(ev)
        }
        // What this scan opened for the first time gets the ceremony: the
        // decode in the scene and the chip that says how many.
        const fresh = get().freshOf(found)
        // What is gone from the bag is known only from the canonical relay's answer.
        if (!asked.trouble) get().dropStale(read, deletions, found)
        if (found.length > 0) get().addDiscovered(found)
        get().honorRetractions([lookupId], events, deletions)
        if (fresh.length > 0) useCeremony.getState().mark(fresh)
        return asked.trouble && found.length === 0 ? -1 : found.length
      } catch {
        return -1
      } finally {
        set({ scanning: false })
      }
    },

    ownDoorAddresses: (lookupIds) => {
      const me = cyber().identity.pubkey
      const wanted = new Set(lookupIds)
      const ids = new Set(get().mine.filter((d) => wanted.has(d.lookupId) && d.chest?.door !== undefined && d.inner.pubkey === me && d.published).map((d) => d.lookupId))
      return [...ids].map((id) => `${HIDDEN_KIND}:${me}:${id}`)
    },

    dropStale: (bags, deletions, refiled) => {
      const discovered = get().discovered
      const gone = staleFinds(discovered, bags, deletions, new Set(refiled.map((h) => h.eventId)))
      if (gone.length === 0) return
      const next = { ...discovered }
      for (const id of gone) delete next[id]
      set({ discovered: next })
    },

    honorRetractions: (lookupIds, bags, deletions) => {
      const me = cyber().identity.pubkey
      const standing = new Set(bags.map(bagAddressOf))
      for (const address of get().ownDoorAddresses(lookupIds)) {
        if (standing.has(address)) continue
        const at = retractedAt(address, deletions)
        if (at > 0 && address.split(':')[1] === me) pruneGoneRows(address.split(':')[2], new Set(), at)
      }
    },

    deleteInstance: async (eventId, opts) => {
      // A failed move's old version goes back first, so the retraction
      // below is judged against what the relays really hold.
      if (get().mine.find((d) => d.eventId === eventId)?.putBack) {
        const back = await putBackNow(eventId)
        if (back) eventId = back.eventId
      }
      const item = get().mine.find((d) => d.eventId === eventId)
      if (!item) return
      const cs = cyber()
      // The last copy of a key something of yours is sealed to stays, its own or one forged inside it (rowLoss); the card says why.
      const loss = rowLoss(item, get().mine, useInventory.getState().items, cs.identity.pubkey)
      set({ lostKeys: loss?.keys ?? null })
      if (loss) return
      const key = hexToBytes(item.keyHex)
      // Taking something down reaches the relay whenever the bag is already
      // there, LOCAL or not. LOCAL used to silence this, which meant a
      // published bag deleted while LOCAL was deleted only on this device and
      // stayed on the relay for good, with nothing on screen saying so.
      // Deleting is an explicit act on one bag, exactly as publishing one is,
      // and it tells the relay nothing it does not already hold.
      const wasPublic = get().mine.some((d) => d.lookupId === item.lookupId && d.published)

      // What is really in this bag, gathered the way publishing gathers it:
      // from the relay as well as from here (gatherInners, which only ever
      // reads this identity's own envelopes, so a bag never holds anyone
      // else's work). This device's own list is not the bag. Something hidden
      // in the same region from another device is in the bag and not in the
      // list, and going by the list alone both dropped it from a rewrite and,
      // when it was the only other thing, deleted the whole envelope as if
      // the bag were empty.
      // A move asks with opts, and takes the failure as its own to report. On its
      // own, DELETE closed its card first, so a toast is what is left to say so.
      const refused = (err: unknown): null => {
        if (opts) throw err
        useToast.getState().show({ label: 'NOT DELETED', meta: err instanceof Error ? err.message : String(err), mark: 'build' })
        return null
      }
      const gathered = await gatherInners(item.lookupId, key, wasPublic, item.height, cs.identity.pubkey).catch(refused)
      if (!gathered) return
      // Its entry as the bag holds it, inline, by reference or sealed (standsFor). A sealed one is retracted once the bag without it is out (sendBag).
      const left = gathered.entries.filter((e) => !standsFor(e, item))
      const me = cs.identity.pubkey

      // The change, not the list: another tab may add a row during the awaits below.
      let after = (rows: MyDeployment[]): MyDeployment[] => rows.filter((d) => d.eventId !== eventId)
      // Whether the relays now hold a bag that no longer names this item.
      let unnamed = false
      if (left.length > 0) {
        // Rewrite the region bag without this item; the newer bag replaces it,
        // with the bag's settings as they stand.
        const settings = gathered.settings ?? DEFAULT_BAG_SETTINGS
        const sent = await publishBag(left, key, item.lookupId, item.height, wasPublic, settings, { at: positionOf(item), plane: item.plane }, undefined, gathered.entries, cs.identity.pubkey).catch(refused)
        if (!sent) return
        const { event, published } = sent
        unnamed = published
        after = (rows) => rows.filter((d) => d.eventId !== eventId).map((d) => (d.lookupId === item.lookupId ? { ...d, bagId: event.id, bagAt: event.created_at, published, bag: settings } : d))
      } else {
        // The last thing in the region: delete the envelope itself (NIP-09).
        if (wasPublic) {
          if (cyber().identity.pubkey !== me) { refused(new Error(SWITCHED)); return }
          let deletedAt: number
          try { deletedAt = nextBagAt(item.lookupId) } catch (err) { refused(err); return }
          const del = await cs.signEvent({
            kind: 5,
            created_at: deletedAt,
            content: 'hidden content removed',
            // kind 33330 is addressable, so the address is what a relay
            // replaces and what NIP-09 asks for; the event id goes too, for
            // relays that only match that.
            tags: [['a', `${HIDDEN_KIND}:${me}:${item.lookupId}`], ['e', item.bagId], ['k', String(HIDDEN_KIND)]],
          })
          let tookDel: string[] = []
          try { const r = await publishMany(item.relays ?? relaySet(), del); unnamed = r.ok; tookDel = tookOf(r, item.relays ?? relaySet()) } catch { /* best effort */ }
          // The bag is gone: so is any sealed entry it named (spec §7.6 Retracting), on the relays that took its deletion.
          if (unnamed) await retractSealedAmong(gathered.entries, me, tookDel)
        }
      }
      // A shard hidden by reference is also its own event. Once no bag names
      // it, take that down too (NIP-09), if it is ours to take down: it is
      // sealed, but its preview would otherwise sit on the relay for good.
      // Only once the relays hold a bag that no longer names it: retracting it
      // while the old bag still does would leave that bag with a hole.
      // Never by address while the address holds something newer: after an
      // EDIT the object under this `d` is the moved shard's (review of #369).
      const sharedHere = !!item.ref && get().mine.some((d) => d.eventId !== eventId && d.ref?.[1] === item.ref?.[1])
      if (item.ref && item.inner.pubkey === me && wasPublic && unnamed && !opts?.keepObject && !sharedHere && (await addressStillThis(referenced(item.inner))) === 'this') {
        try { await retractObject(referenced(item.inner), item.relays ?? relaySet()) } catch { /* best effort */ }
        forgetReference(item.ref)
      }

      const deleted = { ...get().deleted, [eventId]: true as const }
      const discovered = { ...get().discovered }
      delete discovered[eventId]
      // The whole bag is gone only when nothing of ours is left in it. The
      // public list is a list of bags, so that is the grain it forgets at.
      const deletedBags = left.length > 0
        ? get().deletedBags
        : { ...get().deletedBags, [`${me}:${item.lookupId}`]: true as const }
      set({ deleted, deletedBags, discovered })
      void commitRows(me, after(rowsOf(me))); saveDeleted(deleted)
      if (left.length === 0) saveDeletedBags(deletedBags)
    },

    removeFromChest: async (eventId) => {
      // A thing revealed from a chest is not a bag entry but part of the
      // chest's sealed contents, so DELETE's rewrite of the bag's entries
      // could never reach it (arkinox, 2026-10-10: "delete just does
      // nothing"). Taking it out means opening the chest, sealing it again
      // without that content, and rewriting the bag with the new chest where
      // the old one was. Only the chest's hider can sign that, and only with
      // a key that opens the chest: a chest is sealed with a one-time sender
      // key, so even its hider has no other way in.
      const found = get().discovered[eventId]
      if (!found?.chestId) return 'This was not revealed from a chest.'
      const chest = get().mine.find((d) => d.eventId === found.chestId && d.type === 'chest')
      if (!chest?.chest) return 'Only the chest’s hider can change what is inside it, from the device that hid it.'
      const cs = cyber()
      const me = cs.identity.pubkey
      const opener = openerFor(chest.chest, hiderKeys(useInventory.getState().items, get().mine, me), me, lookupLock)
      if (!opener) return 'Opening the chest needs the key it is sealed to, which this device does not hold.'
      let raw: BagEntry[]
      try {
        raw = opener.by === 'key' ? openWithSecret(chest.chest, opener.key.secretHex) : await openWithSigner(chest.chest, cs.decryptSealed)
      } catch (err) {
        return `The chest did not open: ${err instanceof Error ? err.message : String(err)}`
      }
      const resealed = resealWithout(chest.chest, raw, eventId)
      if (!resealed) return 'That is no longer inside this chest.'
      // Taking out the last copy of a key something of yours is sealed to is refused (keysLost), with ARCHIVE offered.
      const leftIds = new Set(resealed.left.map(entryKey))
      const taken = raw.filter((e) => !leftIds.has(entryKey(e)))
      const loss = keysLost(keysOfRow({ ...chest, key: undefined, sealed: taken }, me), get().mine.map((m) => (m.eventId === chest.eventId ? { ...m, sealed: resealed.left } : m)), useInventory.getState().items, me)
      set({ lostKeys: loss?.keys ?? null })
      if (loss) return loss.why
      // As the identity that asked: a switch while its signer opened the chest refuses, rather than signing as the next one.
      await replaceChest(chest, resealed.chest, resealed.left, undefined, me)
      const deleted = { ...get().deleted, [eventId]: true as const }
      set({ deleted })
      saveDeleted(deleted)
      if (cyber().identity.pubkey === me) {
        const discovered = { ...get().discovered }
        delete discovered[eventId]
        set({ discovered, selectedSecret: get().selectedSecret === eventId ? null : get().selectedSecret })
      }
      return null
    },

    selectSecret: (eventId) => set({ selectedSecret: eventId }),

    addDiscovered: (items, how) => {
      const watched = how?.watched === true
      if (items.length === 0) return
      const { deleted } = get()
      const discovered = { ...get().discovered }
      let changed = false
      const me = cyber().identity.pubkey
      // What came out of this identity's own chests here, by id, with the
      // region it was in: none of it is claimed as a deployment of the bag,
      // whatever copy of it was seen first.
      const sealed = new Map<string, string>()
      /**
       * File one thing out of a chest opened by hand (OPEN, ItemRows
       * openChestHere, or the restore below). A plain copy, in the same
       * region and by the same hider, of what is sealed in the chest (a bag
       * written by a client that put a chest's contents beside it, publishBag)
       * is replaced by the chest's copy, so it is listed, deleted and taken
       * out as the chest's (removeFromChest), never as an entry of the bag.
       * Whether it was filed now, new or replacing a plain copy.
       */
      const fromChest = (r: Hidden): boolean => {
        if (r.author === me) sealed.set(r.eventId, r.lookupId)
        const held = discovered[r.eventId]
        const plain = !!held && !held.chestId && held.lookupId === r.lookupId && held.author === r.author
        if (held && !plain) return false
        discovered[r.eventId] = r
        changed = true
        return true
      }
      for (const h of items) {
        if (deleted[h.eventId]) continue
        if (h.chestId) { fromChest(h); continue }
        const held = discovered[h.eventId]
        // New, or a LIVE LINK whose author published a newer version: the
        // same find, refreshed, and no second ceremony (review of #233).
        const newer = !!held && !!h.inner && !!held.inner && h.inner.id !== held.inner.id && h.inner.created_at > held.inner.created_at
        if (!held || newer) { discovered[h.eventId] = h; changed = true }
      }
      // Nothing opens by itself (arkinox, 2026-10-26: "everything must be
      // opened or taken manually. that's the whole Zelda experience."): a
      // chest or a door found shows closed, with OPEN when you hold what
      // opens it, and opens only when OPEN is tapped. A scan, a TAKE, TV and
      // a reload open nothing new. The one exception is a chest this
      // identity already opened by hand on this device: after a reload the
      // scan opens it again, as it was, with an item still held
      // (store/useOpenedChests), and a chest inside it only if that one was
      // opened by hand too, under the lock each has now. A chest sealed to
      // this identity is not read here, since a scan never asks a signer: it
      // is drawn open, and its card reads it again when shown (hud/ItemRows
      // readAgain). Nothing TV showed is restored, and a key TV showed opens
      // nothing (review of #390).
      const keys: OpeningKey[] = openingKeys(useInventory.getState().items, true)
      startKeyring()
      // A door of a room this identity closed (§3.7.5, one room, one state) comes in closed,
      // before anything here asks whether it was opened by hand (store/closedDoors).
      if (!watched) void closeArriving(me, items)
      // A door closed with CLOSE is not opened by hand (store/useOpenedChests): never reopened here.
      const byHand = (h: Hidden): boolean => h.type === 'chest' && !!h.chest && openedByHand(me, h.eventId, h.chest.lockPubkey)
      // A door opened by hand opens its room again with the secret this
      // device kept (store/rooms.ts), quietly, after the scan; never one
      // found inside a chest (DECK-0004 §3.7.1).
      const reopen = watched ? [] : items.filter((h) => byHand(h) && !h.chestId && isDoor(h.inner?.tags))
      if (reopen.length > 0) void import('./rooms').then((m) => { for (const d of reopen) void m.reopenRoom(d) })
      const queue = watched ? [] : items.filter((h) => byHand(h) && !(isDoor(h.inner?.tags) && !h.chestId))
      const revealed: Hidden[] = []
      while (queue.length > 0) {
        const door = queue.shift()!
        // A key you carry opens it too (DECK-0004 §3.8), once its lock is derived: a later scan catches up.
        const opener = openerFor(door.chest!, keys, '', lookupLock)
        if (!opener || opener.by !== 'key') continue
        let contents: ChestEntry[]
        try { contents = readContents(openWithSecret(door.chest!, opener.key.secretHex), sealerOf(door)) } catch { continue }
        restoreOpened(me, door.eventId, contents)
        for (const r of revealedIn(door, contents)) {
          if (deleted[r.eventId]) continue
          if (!fromChest(r)) continue
          revealed.push(r)
          if (byHand(r)) queue.push(r)
        }
      }
      if (changed) set({ discovered })
      const all = [...items, ...revealed]
      remember(all.map((h) => h.eventId))
      // What this device once claimed out of a chest goes from the record:
      // it was never an entry of the bag (arkinox, 2026-10-20).
      const claimedOut = (x: { eventId: string; lookupId: string }): boolean => sealed.get(x.eventId) === x.lookupId
      if (get().mine.some(claimedOut)) {
        const mine = get().mine.filter((d) => !claimedOut(d))
        set({ mine })
        saveMine(mine)
      }
      // Watched finds open no chest, so what is sealed in one of this
      // identity's own chests cannot be told from a plain entry beside it.
      // So from TV (and TV's kept bags on a reload) nothing of this
      // identity's beside its own chest is claimed: a played scan claims
      // what really is a bag entry, and a leaked copy never comes back into
      // the record (review of #407). Nor is anything listed as a chest's.
      const ownChestBags = new Set(items.filter((h) => h.type === 'chest' && h.author === me).map((h) => h.bagId))
      const now = get().discovered
      claimOwn(all.filter((h) => !claimedOut(h) && !now[h.eventId]?.chestId && !(watched && h.type !== 'chest' && h.author === me && ownChestBags.has(h.bagId))))
      // Found is not held (arkinox, 2026-10-26: "I dont want items to
      // automatically be added to my inventory the moment i decrypt them
      // from a bag. i want to TAKE them"): a key waits for TAKE (takeFound).
      // One TV showed and that is now found in play is an ordinary key.
      if (!watched) {
        const playedIds = playedFinds(me)
        for (const h of all) playedIds.add(h.eventId)
        useInventory.getState().markPlayed(all)
      }
      // What a reload opened again was found before: no second ceremony.
    },

    takeFound: (eventIds) => {
      const { discovered } = get()
      const me = cyber().identity.pubkey
      const muted = useMutes.getState().muted
      // What the mute list hides is neither listed nor taken (review of #464, S5).
      const finds = eventIds.map((id) => discovered[id]).filter((h): h is Hidden => !!h && h.type === 'key' && !findHidden(h, muted, me))
      const playedIds = playedFinds(me)
      const inPlay = finds.filter((h) => playedIds.has(h.eventId))
      const watchedOnly = finds.filter((h) => !playedIds.has(h.eventId))
      // One revealed from a chest is held as taken from it, the row its
      // chest's own TAKE writes (lib/inventory heldFromFind).
      const inChest = (h: Hidden): InChest | null => {
        if (!h.chestId) return null
        const chest = discovered[h.chestId] ?? get().mine.find((d) => d.eventId === h.chestId)
        const name = chest?.chest?.name ?? ''
        const place = chest ? { lookupId: chest.lookupId, bagId: chest.bagId, at: { x: chest.at.x.toString(), y: chest.at.y.toString(), z: chest.at.z.toString() }, plane: chest.plane, height: chest.height } : placeOf(h)
        return { from: { chestId: h.chestId, chestName: name }, place }
      }
      const inv = useInventory.getState()
      const added = [...(inPlay.length > 0 ? inv.holdFinds(inPlay, false, inChest) : []), ...(watchedOnly.length > 0 ? inv.holdFinds(watchedOnly, true, inChest) : [])]
      // One of your own is no find: TAKE picks it up as forged, the first time
      // (hiding holds nothing, arkinox 2026-11-06) or after a DELETE from ITEMS.
      for (const id of eventIds) {
        const d = discovered[id] ? undefined : get().mine.find((x) => x.eventId === id)
        if (!d?.key || !d.inner || inv.has(id)) continue
        added.push(inv.holdForged(d.inner as NostrEvent, d.key, { lookupId: d.lookupId, bagId: d.bagId, at: d.at, plane: d.plane, height: d.height }))
      }
      // Taking an item opens nothing: the chest it opens waits for OPEN
      // (arkinox, 2026-10-26: "everything must be opened or taken manually").
      return added
    },

    freshOf: (items) => {
      const { discovered, deleted, mine } = get()
      const own = new Set(mine.map((d) => d.eventId))
      return items.filter((h) => !discovered[h.eventId] && !deleted[h.eventId] && !own.has(h.eventId) && !seen.has(h.eventId))
    },

    setScanning: (scanning) => set({ scanning }),

    testDiscovery: async (eventId) => {
      const item = get().mine.find((d) => d.eventId === eventId)
      const me = cyber().identity.pubkey
      const key: DiscoveryKey = item ? discoveryKeyOf(item, me) : { via: 'derived' }
      if (!item || !item.published) return { outcome: 'missing', key }
      // The key and lookup id this device sealed the bag with: the region key
      // at the coordinate (or, in a room, the room key). Never derived on the
      // main thread: near height 20 that froze the page.
      let rk = { key: hexToBytes(item.keyHex), lookupId: item.lookupId }
      // Up to this device's ceiling the key is derived again, as a stranger
      // would, and must be the stored one: a key HOSAKA got wrong (heights a
      // phone hands it) seals a bag nobody finds, and the stored key alone would
      // still find it and say FOUND (review of #622). Above the ceiling, and in
      // a room whose door secret this device lacks, the stored key is all
      // there is, and the result says so.
      // A row GONE FROM ITS BAG (goneFrom) is not compared: its door may have
      // been rekeyed since (retargetRoom), so a fresh key would differ for a
      // reason that is not a wrong key. The relay says where it is: missing.
      if (key.via === 'derived' && inItsBag(item)) {
        // A derivation that fails (its worker crashed, or ran out of time)
        // says so, never NOT FOUND: the relay was never asked.
        let derived: { key: Uint8Array; lookupId: string }
        try {
          const region = await regionKeyOffThread(positionOf(item), item.height, MAX_COMPUTE_HEIGHT)
          const secret = item.room ? doorSecret(me, item.room.doorId) : null
          const roomK = secret ? roomKey(region.key, hexToBytes(secret)) : null
          derived = roomK ? { key: roomK, lookupId: roomLookupId(roomK) } : region
        } catch {
          return { outcome: 'underived', key }
        }
        if (bytesToHex(derived.key) !== item.keyHex.toLowerCase() || derived.lookupId !== item.lookupId) return { outcome: 'wrongKey', key }
        rk = derived
      }
      // Any relay's bag answers it. Only a miss with the canonical relay in
      // trouble (no AUTH, not heard from) is unread rather than missing.
      const { events, trouble } = await queryChecked({ kinds: [HIDDEN_KIND], '#d': [rk.lookupId] })
      let refused = false
      for (const ev of events) {
        const h = BigInt(item.height)
        const p = positionOf(item)
        const items = await unbag(ev, rk.key, resolveReference, { at: { x: (p.x >> h) << h, y: (p.y >> h) << h, z: (p.z >> h) << h }, plane: item.plane }, item.height, undefined, item.room).catch(() => [])
        if (items.some((h) => h.eventId === eventId)) return { outcome: 'found', key }
        // The bag opened and this item is in it, signed, yet unbag dropped it:
        // the format refused it, and every other client will too.
        if (!refused) refused = (await bagInners(ev, rk.key)).some((e) => e.id === eventId)
      }
      return { outcome: refused ? 'refused' : trouble ? 'unread' : 'missing', key }
    },

    pendingShard: () => {
      const { pending } = get()
      if (pending?.type !== 'shard') return null
      if (pending.edit) return get().mine.find((d) => d.eventId === pending.edit?.eventId)?.shard ?? null
      return pending.object?.shard ?? useWorkshop.getState().shards.find((s) => s.id === pending.shardId) ?? null
    },

    setCurated: (authors) => { if (get().curated !== authors) set({ curated: authors }) },

    worldItems: () => {
      const curated = get().curated
      // What the person's mute list hides (store/useMutes): never their own.
      const muted = useMutes.getState().muted
      const me = useCyberspace.getState().identity.pubkey
      const shown = (w: WorldItem): boolean => !worldItemHidden(w, muted, me)
      if (curated) return worldOf(get()).filter((w) => w.author !== undefined && curated.includes(w.author) && shown(w))
      return worldOf(get()).filter(shown)
    },

    drawnItems: () => {
      const { discovered, mine } = get()
      const parent = (chestId: string): { at: Position; tags?: readonly unknown[] } | undefined => {
        const h = discovered[chestId]
        if (h) return { at: h.at, tags: h.inner?.tags }
        const d = mine.find((x) => x.eventId === chestId)
        return d ? { at: positionOf(d), tags: d.inner?.tags } : undefined
      }
      return get().worldItems().filter((w) => !keptInChest(w, w.chestId ? parent(w.chestId) : undefined))
    },

    heardAudio: () => get().worldItems().filter((w) => w.type === 'audio'),

    secretByEvent: (eventId) => get().worldItems().find((w) => w.key === eventId) ?? null,
  }

  /** Everything in the world, before any curation. */
  function worldOf(state: ShardsState): WorldItem[] {
    const out: WorldItem[] = []
    const seen = new Set<string>()
    const me = useCyberspace.getState().identity.pubkey
    const shut = closedRoomTest(state, me)
    for (const d of state.mine) {
      seen.add(d.eventId)
      // Gone from its bag: not there to draw (DEPLOYED lists it, with HIDE AGAIN and FORGET).
      if (!inItsBag(d)) continue
      // In a room whose door you closed (CLOSE): dissolved with it, yours too, until OPEN.
      if (shut?.(d.eventId)) continue
      out.push({ key: d.eventId, type: d.type, at: positionOf(d), plane: d.plane, height: d.height, mine: true, author: me, shard: d.shard, text: d.text, keyItem: d.key, chest: d.chest, audio: d.audio, createdAt: d.createdAt, lookupId: d.lookupId, bagId: d.bagId, bagKeyHex: d.keyHex, target: itemTargetOf(d.inner, d.ref), event: d.inner as NostrEvent, ...keptLineage(d) })
    }
    for (const h of Object.values(state.discovered)) {
      if (seen.has(h.eventId)) continue
      if (shut?.(h.eventId)) continue
      out.push({ key: h.eventId, type: h.type, at: h.at, plane: h.plane, height: h.height, mine: false, author: h.author, shard: h.shard, text: h.text, keyItem: h.key, chest: h.chest, audio: h.audio, createdAt: h.createdAt, lookupId: h.lookupId, bagId: h.bagId, ...(h.keyHex ? { bagKeyHex: h.keyHex } : {}), target: itemTargetOf(h.inner, h.ref), chestId: h.chestId, event: h.inner as NostrEvent | undefined, ...lineageOf(h.inner, h.ref) })
    }
    return oneVersionEach(out)
  }
})

/**
 * Whether a thing stands in a room whose door this identity closed (CLOSE,
 * arkinox, 2026-11-01), or in a room inside one, or came out of a chest that
 * does: dissolved with the room, until OPEN. Null when no door is closed, the
 * usual case, so the world is read as it always was.
 */
export function closedRoomTest(state: Pick<ShardsState, 'mine' | 'discovered'>, me: string): ((id: string) => boolean) | null {
  const closed = closedDoorIds(me)
  if (closed.size === 0) return null
  const info = new Map<string, { room?: string; chestId?: string; lock?: string }>()
  for (const d of state.mine) info.set(d.eventId, { room: d.room?.doorId, lock: d.chest?.lockPubkey })
  for (const h of Object.values(state.discovered)) if (!info.has(h.eventId)) info.set(h.eventId, { room: h.room?.doorId, chestId: h.chestId, lock: h.chest?.lockPubkey })
  const known = new Map<string, boolean>()
  const shut = (id: string, depth = 0): boolean => {
    const was = known.get(id)
    if (was !== undefined) return was
    const t = info.get(id)
    let out = false
    if (t && depth < 64) {
      if (t.room) {
        const door = info.get(t.room)
        // Under the lock the door has now; a door not at hand, under any.
        out = (closed.has(t.room) && closedByMe(me, t.room, door?.lock)) || shut(t.room, depth + 1)
      }
      if (!out && t.chestId) out = shut(t.chestId, depth + 1)
    }
    known.set(id, out)
    return out
  }
  return shut
}

// The build STEP belongs to one deploy: when it ends, hidden or canceled, or
// another is lined up in its place, the step goes back to the zoom. A
// placement lined up again (`placedLast`) keeps it, as it keeps every other
// setting.
useShards.subscribe((s, prev) => {
  const cs = useCyberspace.getState()
  const again = s.pending !== null && s.pending === s.placedLast?.pending
  if (s.pending !== prev.pending && !again && (cs.buildStep !== null || cs.buildSettle !== null)) cs.setBuildStep(null)
})

/**
 * YOURS is the signed-in identity's list and nobody else's: read it now, and
 * again on every switch. A card open on the old identity's row closes with it.
 * useCyberspace reaches this file through lib/destinationKeys and useSecrets, so
 * it may not have finished loading while this one runs; then this tries again
 * as soon as the loading stops.
 */
function followIdentity(tries = 0): void {
  let me = ''
  try {
    me = useCyberspace.getState().identity.pubkey
    if (!me || !useCyberspace.subscribe) throw new Error('not loaded')
  } catch {
    // About ten seconds, for a slow load. A test that mocks useCyberspace away never has it.
    if (tries < 200) setTimeout(() => followIdentity(tries + 1), tries === 0 ? 0 : 50)
    return
  }
  const claim = (owner: string): void => {
    void claimUnclaimed(owner).catch((err) => console.warn(`[shards] could not claim hidden items: ${err instanceof Error ? err.message : String(err)}`))
  }
  if (useShards.getState().mine === NOT_READ_YET) useShards.setState({ mine: loadMine(me) })
  claim(me)
  useCyberspace.subscribe((s, prev) => {
    const owner = s.identity.pubkey
    if (owner === prev.identity.pubkey) return
    forgetSealedState()
    const { mine: left, selectedSecret } = useShards.getState()
    const mine = loadMine(owner)
    const closes = selectedSecret !== null && left.some((d) => d.eventId === selectedSecret) && !mine.some((d) => d.eventId === selectedSecret)
    useShards.setState(closes ? { mine, selectedSecret: null } : { mine })
    claim(owner)
  })
  // The room a placement joins follows the build cursor (syncRoomSnap).
  useCyberspace.subscribe((s, prev) => {
    if (s.cursor === prev.cursor && s.plane === prev.plane && s.anchorPlane === prev.anchorPlane && s.focus === prev.focus && s.identity.pubkey === prev.identity.pubkey) return
    if (useShards.getState().pending) useShards.getState().syncRoomSnap()
  })
  // Stored rows changed under this list: the move finished, or another tab wrote.
  onHiddenChange(() => {
    useShards.setState({ mine: loadMine(useCyberspace.getState().identity.pubkey) })
  })
  // In local mode, the other tab's word is a storage event.
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', (e: StorageEvent) => { if (e.key?.startsWith('onosendai:deployments')) reloadLocalView() })
  }
}
followIdentity()

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __shards?: unknown }).__shards = useShards
}

// The X on the door-name chip leaves one placement out (R2): whatever is
// lined up next asks again. A chest being placed and then filled is one placement.
useShards.subscribe((s, prev) => {
  if (s.pending === prev.pending || (s.deployLeaveOut.length === 0 && !s.deploySealMove)) return
  if (s.pending?.type === 'chest' && prev.pending?.type === 'chest') return
  useShards.setState({ deployLeaveOut: [], deploySealMove: false })
})

// The room a placement joins follows what it depends on here: what is lined
// up, your doors, the X, and ROOM HEIGHT. The cursor's side is followIdentity's.
useShards.subscribe((s, prev) => {
  if (s.pending === prev.pending && s.mine === prev.mine && s.deployHeight === prev.deployHeight && s.deploySealMove === prev.deploySealMove && s.deployLeaveOut === prev.deployLeaveOut && s.deployDoorHeight === prev.deployDoorHeight && s.deployRoomSnap === prev.deployRoomSnap && s.deployStatus === prev.deployStatus) return
  s.syncRoomSnap()
})
