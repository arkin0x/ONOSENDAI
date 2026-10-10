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
 * it carries its height (`h`), a sector hint, and a riddle (lib/hidden.ts
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
 * a chest, goes into the hider's own inventory at once (store/useInventory.ts),
 * and every key a scan reads is held the moment it is read. A shard inside a
 * chest may be aimed first (startDeployIntoChest, arkinox 2026-10-10): signed
 * through the deploy bar where it should stand when the chest opens, and
 * sealed as it is.
 */

import { clampUnit, normalizeStored } from 'sno-core/shards'
import { snapOffered, wrapSpin } from '../lib/pose'
import { create } from 'zustand'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from './useCyberspace'
import { publishMany, query, relaySet } from '../lib/relay'
import { forgetReference, resolveReference } from '../lib/references'
import { itemTargetOf, type ItemTarget } from '../lib/comments'
import { bytesToHex, hexToBytes, type EventTemplate, type NostrEvent } from '../lib/events'
import { regionKeyAt } from '../lib/shardCrypto'
import { regionKeyOffThread } from '../lib/regionKeyOffThread'
import { cloudKeyQuote, deployCeiling, deployRoute, localKeyCeiling, needsAsk } from '../lib/deployPlan'
import { useSecrets } from './useSecrets'
import {
  DEFAULT_BAG_SETTINGS,
  HIDDEN_KIND,
  OBJECT_KIND,
  bagEntries,
  bagSettingsOf,
  resolveBagSettings,
  type BagSettings,
  bagInners,
  bagTemplate,
  entryKey,
  linkKey,
  objectTemplate,
  referenceTo,
  wantsReference,
  type BagEntry,
  type Reference,
  chestInnerTemplate,
  keyInnerTemplate,
  messageInnerTemplate,
  messagePreview,
  shardInnerTemplate,
  shardRefusal,
  unbag,
  type ChestItem,
  type Hidden,
  type HiddenType,
  type KeyItem,
} from '../lib/hidden'
import { openWithSecret, openWithSigner, openerFor, readContents, resealWithout, revealedIn, sealEntries, type OpeningKey } from '../lib/chests'
import { openingKeys, type HeldPlace } from '../lib/inventory'
import { useInventory } from './useInventory'
import { creditOf, useWorkshop } from './useWorkshop'
import { deletionFilters, isDeleted, type Credit, type FeedObject } from 'sno-core/feed'
import { useCeremony } from './useCeremony'
import { useToast } from './useToast'
import type { ShardModel } from 'sno-core/shards'
import type { Plane } from 'cyberspace-core'
import { deployPoint, type Position } from '../lib/space'
import { buildCursorOf, buildPlane, buildStepOf } from '../lib/buildCursor'
import type { NearbyReturn } from '../lib/nearbyReturn'
import { turnShard, type Turns } from '../lib/turn'
import { alignedBase, hintFits } from '../lib/hint'

/** One item this device hid. Its identity is its inner event id. */
export interface MyDeployment {
  /** The item's stable identity: its signed inner event id. */
  eventId: string
  /**
   * The signed inner event, so the region bag can be rebuilt from here. For a
   * shard hidden by reference it is the signed kind 33331 object, which is
   * what `broadcast` republishes beside the bag.
   */
  inner: NostrEvent
  /** Set when the item is hidden by reference: the entry the bag carries instead of `inner` (spec §7.6). */
  ref?: Reference
  /** The envelope currently holding it; changes when the bag is rewritten. */
  bagId: string
  type: HiddenType
  shard?: ShardModel
  text?: string
  key?: KeyItem
  chest?: ChestItem
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
  createdAt?: number
  /** The bag's lookup id, for anything addressed to the bag (comments). */
  lookupId?: string
  /** The bag's event id, for the inventory's record of where a thing was found. */
  bagId?: string
  /** For an item hidden by reference: the event comments answer (lib/comments ItemTarget). */
  target?: ItemTarget
  /** The chest this was revealed from, when it came out of one: its hider takes it out with removeFromChest, not DELETE. */
  chestId?: string
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
  /** A new key forged inline, for chaining: it is held by you the moment the chest is hidden. */
  | { kind: 'key'; key: KeyItem }

/** What a chest is sealed to, and how the composer named it. */
export interface ChestLock {
  pubkey: string
  /** For the bar and the ghost: the key's name, or "a person". */
  label: string
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
   */
  | { type: 'shard'; shardId: string; object?: FeedObject; intoChest?: { draft: ChestDraft; contentIndex: number } }
  | { type: 'message'; text: string }
  /** A key forged in the composer: the keypair is made there, so its public key can be shown and sealed to before it is hidden. */
  | { type: 'key'; key: KeyItem }
  | ({ type: 'chest' } & ChestDraft)

/** The name a pending deploy goes by in the bar and the ghost. */
export function pendingName(pending: DeployPending, shard: ShardModel | null): string {
  switch (pending.type) {
    case 'message': return messagePreview(pending.text)
    case 'key': return pending.key.name
    case 'chest': return pending.name
    default: return shard?.name ?? 'shard'
  }
}

/** Whether a pending deploy has nothing in it to hide. */
export function pendingEmpty(pending: DeployPending, shard: ShardModel | null): boolean {
  switch (pending.type) {
    case 'message': return pending.text.trim().length === 0
    case 'key': return pending.key.name.trim().length === 0
    case 'chest': return pending.name.trim().length === 0 || pending.contents.length === 0
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
export interface OwnBag { region: string; settings: BagSettings; count: number }

/**
 * Your bag in this region, from `mine`, or null when this device knows of none.
 * The settings are the newest item's: every rewrite stamps them on every item
 * in the region, so they agree, and the newest is the latest word if not.
 */
export function ownBagIn(mine: MyDeployment[], region: string): OwnBag | null {
  const items = mine.filter((d) => regionOf(positionOf(d), d.plane, d.height) === region)
  if (items.length === 0) return null
  const newest = items.reduce((a, b) => (b.createdAt > a.createdAt ? b : a))
  return { region, settings: newest.bag ?? DEFAULT_BAG_SETTINGS, count: items.length }
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
   * The bag settings the deploy bar shows and the deploy writes: `h`, the
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
  /** What the deploy is doing right now, for the button: computing, buying, publishing. */
  deployNote: string | null
  /** A HOSAKA purchase waiting for a yes: the price and the wait. Null when not asking. */
  deployAsk: { sats: number | null; seconds: number | null } | null
  deployError: string | null
  mine: MyDeployment[]
  discovered: Record<string, Hidden>
  deleted: Record<string, true>
  /** Bags taken down from here, by `author:lookupId`: what the public LOOT list matches on. */
  deletedBags: Record<string, true>
  inspecting: string | null
  scanning: boolean
  /** The region whose bag is being sent to the relays right now, by lookup id. */
  broadcasting: string | null
  /** Why the last broadcast failed, for the row that asked for it. */
  broadcastError: string | null
  /** A world item clicked open, by its inner event id. */
  selectedSecret: string | null
  /** Whether the Nearby Loot list is on screen: what is decrypted where you stand. */
  nearbyOpen: boolean
  setNearbyOpen: (open: boolean) => void
  /** What VIEW on a Nearby Loot row will return to (lib/nearbyReturn.ts); null when nothing is pending. */
  nearbyReturn: NearbyReturn | null
  setNearbyReturn: (r: NearbyReturn | null) => void

  startDeployShard: (shardId: string) => void
  startDeployMessage: (text: string) => void
  /** Hide a key the composer forged (B1 §3.1). */
  startDeployKey: (key: KeyItem) => void
  /** Hide a chest as the composer drafted it; its contents are signed (the aimed ones already are) and sealed when it is hidden. */
  startDeployChest: (draft: ChestDraft & { lock: ChestLock }) => void
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
  cancelDeploy: () => void
  /** Hide the pending thing at the cursor. `confirmed` is the yes to a HOSAKA ask. */
  deploy: (confirmed?: boolean) => Promise<void>
  deleteInstance: (eventId: string) => Promise<void>
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
   * there, because a bag need not carry `h` (spec §8.6).
   */
  rescan: (lookupId: string, keyHex: string) => Promise<number>
  inspect: (eventId: string | null) => void
  selectSecret: (eventId: string | null) => void
  /** File what a scan opened. A find this identity wrote joins `mine` as well, whichever device placed it. */
  addDiscovered: (items: Hidden[]) => void
  /**
   * The items among these that earn the reveal and the toast: never opened on
   * this device before, not this identity's own, not deleted. The scan and a
   * rescan both ask here, so "new" means one thing everywhere.
   */
  freshOf: (items: Hidden[]) => Hidden[]
  setScanning: (scanning: boolean) => void
  /**
   * Prove the round trip a stranger would make: derive the key from the
   * coordinate, ask the relays, open what comes back. `refused` means the bag
   * came back and this item is in it, but the format refuses it, so no client
   * can show it; the fix is in the workshop, not on the relay.
   */
  testDiscovery: (eventId: string) => Promise<'found' | 'missing' | 'refused'>
  pendingShard: () => ShardModel | null
  worldItems: () => WorldItem[]
  /** The clicked item, mine or discovered, as one shape. */
  secretByEvent: (eventId: string) => WorldItem | null
}

const MINE_KEY = 'onosendai:deployments'
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

function loadMine(): MyDeployment[] {
  try {
    const raw = localStorage.getItem(MINE_KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list.filter((d) => d && d.eventId && d.inner && (d.shard || d.text || d.key || d.chest)).map((d) => (d.shard ? { ...d, shard: normalizeStored(d.shard) } : d)) : []
  } catch { return [] }
}

function saveMine(mine: MyDeployment[]): void {
  try { localStorage.setItem(MINE_KEY, JSON.stringify(mine)) } catch { /* quota or private mode */ }
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

export function positionOf(d: { at: { x: string; y: string; z: string } }): Position {
  return { x: BigInt(d.at.x), y: BigInt(d.at.y), z: BigInt(d.at.z) }
}

/** The reverse: a position as the decimal strings a deployment keeps. */
function storedAt(p: Position): { x: string; y: string; z: string } {
  return { x: p.x.toString(), y: p.y.toString(), z: p.z.toString() }
}

/** What a deployment contributes to its region's bag: the reference if it has one, else the inner event. */
function entryOf(d: Pick<MyDeployment, 'inner' | 'ref'>): BagEntry {
  return d.ref ?? d.inner
}

/** Union of bag entries by identity (event id, or the reference's target), order preserved. */
function mergeEntries(a: BagEntry[], b: BagEntry[]): BagEntry[] {
  const seen = new Set(a.map(entryKey))
  const out = a.slice()
  for (const e of b) { const k = entryKey(e); if (!seen.has(k)) { seen.add(k); out.push(e) } }
  return out
}

/** A fresh `d` for one placement of an object: 16 random bytes, derived from nothing (DECK-0003 §3.4). */
function placementId(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)))
}

/**
 * A per-region clock so each rewrite of a bag is strictly newer than the last,
 * which is what makes the relay keep the new one (addressable replacement takes
 * the greatest created_at). Session-local; seeded from what is already on disk.
 */
const bagClock = new Map<string, number>()
function nextBagAt(lookupId: string): number {
  const now = Math.floor(Date.now() / 1000)
  const at = Math.max(now, (bagClock.get(lookupId) ?? 0) + 1)
  bagClock.set(lookupId, at)
  return at
}

export const useShards = create<ShardsState>((set, get) => {
  const cyber = () => useCyberspace.getState()

  /** Take down an object hidden by reference (NIP-09), once no bag names it. */
  async function retractObject(object: NostrEvent, relays: string[] = relaySet()): Promise<void> {
    const d = object.tags.find((t) => t[0] === 'd')?.[1] ?? ''
    const del = await cyber().signEvent({
      kind: 5,
      created_at: Math.floor(Date.now() / 1000),
      content: 'hidden object removed',
      tags: [['a', `${OBJECT_KIND}:${object.pubkey}:${d}`], ['e', object.id], ['k', String(OBJECT_KIND)]],
    })
    await publishMany(relays, del)
  }

  /** Build and publish the region bag, with its settings; `place` is any point in the region, for a hint's base. */
  async function publishBag(inners: BagEntry[], key: Uint8Array, lookupId: string, height: number, live: boolean, settings: BagSettings, place: { at: Position; plane: Plane }): Promise<{ event: NostrEvent; published: boolean }> {
    const createdAt = nextBagAt(lookupId)
    const event = await cyber().signEvent(await bagTemplate(inners, key, lookupId, height, createdAt, HIDDEN_KIND, settings, place))
    const result = live ? await publishMany(relaySet(), event) : { ok: true as const }
    return { event, published: live && result.ok }
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
  async function gatherInners(lookupId: string, key: Uint8Array, live: boolean, height: number): Promise<{ entries: BagEntry[]; settings: BagSettings | null }> {
    const items = get().mine.filter((d) => d.lookupId === lookupId)
    const local = items.map(entryOf)
    const localSettings = items.length > 0 ? items.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)).bag ?? DEFAULT_BAG_SETTINGS : null
    if (!live) return { entries: local, settings: localSettings }
    try {
      const events = await query({ kinds: [HIDDEN_KIND], authors: [cyber().identity.pubkey], '#d': [lookupId] })
      const newest = events.sort((a, b) => b.created_at - a.created_at)[0]
      const relay = newest ? await bagEntries(newest, key) : []
      // A relay copy that does not open with this key is not this bag.
      const settings = newest && relay.length > 0 ? bagSettingsOf(newest, height) : localSettings
      return { entries: mergeEntries(relay, local), settings }
    } catch {
      return { entries: local, settings: localSettings }
    }
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
    })
    for (const h of items) {
      if (h.author !== me || !h.inner || !h.keyHex || have.has(h.eventId) || deleted[h.eventId]) continue
      have.add(h.eventId)
      own.push({
        eventId: h.eventId, inner: h.inner, ref: h.ref, bagId: h.bagId, type: h.type, shard: h.shard, text: h.text, key: h.key, chest: h.chest,
        at: storedAt(h.at), plane: h.plane, height: h.height, lookupId: h.lookupId, keyHex: h.keyHex,
        relays: relaySet(), createdAt: h.createdAt, published: true, bag: h.bag,
      })
    }
    if (own.length === 0 && !refreshed) return
    const next = [...updated, ...own]
    set({ mine: next })
    saveMine(next)
  }

  /** The same fresh-deploy state every start shares: no pose, no link, the bag settings at their defaults. */
  const freshDeploy = {
    deployLink: false, deployHeightAuto: false, deployUnit: 0, deployUp: false, deploySpin: 0, deployTurn: [0, 0, 0] as Turns, deployFollow: false,
    deployBag: DEFAULT_BAG_SETTINGS, deployBagFrom: null, deployStatus: 'idle' as const, deployError: null,
  }

  /**
   * A chest's contents, signed one by one by this identity and sealed to the
   * lock (lib/chests.ts). Signing is here and not in the composer because the
   * contents carry the place they are hidden at, which is only known now, and
   * because a signer may be remote and slow, which the bar shows as work.
   * Returns the chest item for the inner template and the keys forged inside,
   * each with its signed event, for the inventory.
   */
  async function sealChest(draft: ChestDraft, at: Position, plane: Plane, createdAt: number): Promise<{ chest: ChestItem; forged: Array<{ event: NostrEvent; key: KeyItem }> }> {
    const cs = cyber()
    if (!draft.lock) throw new Error('The chest has no lock.')
    const signed: NostrEvent[] = []
    const forged: Array<{ event: NostrEvent; key: KeyItem }> = []
    for (const c of draft.contents) {
      if (c.kind === 'message') {
        const text = c.text.trim()
        if (!text) continue
        signed.push(await cs.signEvent(messageInnerTemplate(text, at, plane, createdAt)))
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
        signed.push(await cs.signEvent(shardInnerTemplate(model, at, plane, createdAt, creditOf(model))))
      } else {
        const event = await cs.signEvent(keyInnerTemplate(c.key, at, plane, createdAt))
        signed.push(event)
        forged.push({ event, key: c.key })
      }
    }
    if (signed.length === 0) throw new Error('The chest is empty.')
    const sealed = sealEntries(signed, draft.lock.pubkey)
    return { chest: { name: draft.name.trim(), lockPubkey: draft.lock.pubkey, senderPubkey: sealed.senderPubkey, requires: draft.requires.trim(), payload: sealed.payload }, forged }
  }

  return {
    pending: null,
    chestBack: null,
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
    deployLink: false,
    deployBag: DEFAULT_BAG_SETTINGS,
    deployBagFrom: null,
    deployStatus: 'idle',
    deployNote: null,
    deployAsk: null,
    deployError: null,
    mine: loadMine(),
    discovered: {},
    deleted: loadDeleted(),
    deletedBags: loadDeletedBags(),
    inspecting: null,
    scanning: false,
    broadcasting: null,
    broadcastError: null,
    selectedSecret: null,
    nearbyOpen: false,
    nearbyReturn: null,
    setNearbyOpen: (open) => set({ nearbyOpen: open }),
    setNearbyReturn: (r) => set({ nearbyReturn: r }),

    // A new deploy starts at the shard's own size, so the last deploy's choice
    // never carries silently into this one.
    startDeployShard: (shardId) => set({
      pending: { type: 'shard', shardId },
      deployLink: false,
      deployHeightAuto: true,
      deployUnit: useWorkshop.getState().shards.find((s) => s.id === shardId)?.unit ?? 0,
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
    startDeployObject: (object) => set({
      pending: { type: 'shard', shardId: object.address, object },
      // A copy, as B1 rules; LIVE LINK is the deploy bar's choice.
      deployLink: false,
      deployHeightAuto: true,
      deployUnit: object.shard.unit,
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
    // With shards aimed inside, the height starts at the fit that holds them
    // all (DeployBar, lib/deployFit.ts fitHeightAll) and follows the cursor
    // until + or - is pressed, as a shard's own height does.
    startDeployChest: (draft) => set({ pending: { type: 'chest', ...draft }, ...freshDeploy, deployHeightAuto: hasAimed(draft) }),
    startDeployIntoChest: (draft, contentIndex) => {
      const c = draft.contents[contentIndex]
      if (c?.kind !== 'shard') return
      set({
        pending: { type: 'shard', shardId: c.shardId, intoChest: { draft, contentIndex } },
        deployLink: false,
        deployHeightAuto: true,
        // A re-aim starts at the size it was aimed at; a first aim at the model's own.
        deployUnit: c.aimed?.unit ?? useWorkshop.getState().shards.find((s) => s.id === c.shardId)?.unit ?? 0,
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
      // Below the snap's height there is no snap: the control goes away, and
      // so does what it was set to, rather than lying in wait.
      const offered = snapOffered(buildPlane(cyber()), height)
      // A hint smaller than the region cannot contain it (spec §7.7): the
      // sector hint goes off above height 30 the way the snap goes off below
      // its own height, rather than lying in wait.
      const bag = get().deployBag
      const hintGone = bag.hint !== null && !hintFits(bag.hint, height)
      set({ deployHeight: height, deployAsk: null, ...(offered ? {} : { deployUp: false, deployFollow: false }), ...(hintGone ? { deployBag: { ...bag, hint: null } } : {}) })
    },
    setDeployUnit: (unit) => set({ deployUnit: clampUnit(unit) }),
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
        ? { deployLink: true, deployUnit: object.shard.unit, deployTurn: [0, 0, 0], deployUp: false, deployFollow: false, deploySpin: 0, deployAsk: null }
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
    cancelDeploy: () => {
      if (get().deployStatus === 'working') return
      // A shard being aimed into a chest gives the chest back as it was: the
      // composer reopens with the draft intact and that shard as before.
      const { pending } = get()
      const chestBack = pending?.type === 'shard' && pending.intoChest ? pending.intoChest.draft : null
      set({ pending: null, deployStatus: 'idle', deployError: null, deployNote: null, deployAsk: null, chestBack })
    },
    confirmDeploy: () => { set({ deployAsk: null }); void get().deploy(true) },
    declineDeploy: () => set({ deployAsk: null }),

    deploy: async (confirmed = false) => {
      const { pending, deployHeight, deployUnit, deployUp, deploySpin, deployTurn, deployBag, deployBagFrom, deployLink } = get()
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
      const { position: cursor, plane } = buildCursorOf(cs)
      const at: Position = deployPoint(cursor, buildStepOf(cs), deployHeight)
      const createdAt = Math.floor(Date.now() / 1000)
      if (deployBag.hint && !hintFits(deployBag.hint, deployHeight)) {
        set({ deployStatus: 'error', deployError: `A sector hint cannot contain a height ${deployHeight} region: a sector is 2^30 on a side. Turn the hint off or hide lower.` })
        return
      }

      // A shard aimed into a chest is signed, not hidden: no key is computed
      // for it, so no route and no HOSAKA ask (its height is only the cell
      // its point is centered in, as for any shard).
      const intoChest = pending.type === 'shard' ? pending.intoChest : undefined

      // Where the key comes from. Above this machine's ceiling it is HOSAKA's,
      // priced as a hop at that height, and the Cloud compute panel's mode says
      // whether to ask first.
      const inputs = { localMax: localKeyCeiling(), cloudMode: cs.cloudPrefs.mode, cloudCap: cs.cloud.limits?.max_hop_height ?? null }
      const route = deployRoute(deployHeight, inputs)
      if (route === 'cloud' && !intoChest) {
        if (cs.cloudPrefs.mode === 'off' || deployHeight > deployCeiling(inputs)) {
          set({ deployStatus: 'error', deployError: `Height ${deployHeight} is past what this machine computes, and cloud compute is off.` })
          return
        }
        const quote = cloudKeyQuote(deployHeight, cs.cloud.provider?.pricing?.hop)
        if (!confirmed && needsAsk(cs.cloudPrefs.mode, quote?.sats ?? null, cs.cloudPrefs.autoMaxSats)) {
          set({ deployAsk: { sats: quote?.sats ?? null, seconds: quote?.seconds ?? null }, deployError: null })
          return
        }
      }

      let shard: ShardModel | undefined
      let text: string | undefined
      let key: KeyItem | undefined
      let chest: ChestItem | undefined
      // Keys forged inside a chest, held by the hider once the chest is hidden.
      let forgedInside: Array<{ event: NostrEvent; key: KeyItem }> = []
      let innerTemplate: EventTemplate | undefined
      // From the Shard Feed: the author's object, by reference (LIVE LINK) or
      // as a copy that credits it (DECK-0003 §3.2; ruling B1).
      const object = pending.type === 'shard' ? pending.object : undefined
      const link = !!object && deployLink
      if (pending.type === 'shard') {
        const model = object ? object.shard : useWorkshop.getState().shards.find((s) => s.id === pending.shardId)
        // An object of parts alone is an object (DECK-0003 §1.9 rule 13).
        if (!model || (model.vertices.length === 0 && (model.parts?.length ?? 0) === 0)) return
        // The deploy carries its own size. A unit the deploy bar changed makes
        // a copy rather than writing back to the bench, so the same shard can
        // be placed twice at two sizes and the workshop's model is untouched
        // either time; the payload `toPayload` builds takes the unit from here.
        // The pose goes out with the size, and only where there is ground to
        // stand on: dataspace, at SNAP_MIN_HEIGHT and above (lib/pose.ts).
        const up = deployUp && snapOffered(plane, deployHeight)
        const spin = up ? wrapSpin(deploySpin) : 0
        // The TURN row turns this copy by quarter turns (lib/turn.ts); the
        // workshop's model is never touched.
        const turned = turnShard(model, deployTurn)
        // Linked, it is drawn from the author's event as they publish it:
        // nothing of this deploy's size or pose can travel with a reference.
        shard = link || (turned === model && model.unit === deployUnit && model.up === up && model.spin === spin)
          ? model
          : { ...turned, unit: deployUnit, up, spin }
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
        const credit: Credit | undefined = object ? { address: object.address, relay: object.seen?.[0] } : creditOf(model)
        innerTemplate = shardInnerTemplate(shard, at, plane, createdAt, credit)
      } else if (pending.type === 'key') {
        if (!pending.key.name.trim()) return
        key = { ...pending.key, name: pending.key.name.trim(), about: pending.key.about.trim() }
        innerTemplate = keyInnerTemplate(key, at, plane, createdAt)
      } else if (pending.type === 'chest') {
        // Signed and sealed inside the try below: the contents are signed by
        // the identity, which may be a remote signer, and the bar shows it.
        if (!pending.name.trim() || pending.contents.length === 0 || !pending.lock) return
      } else {
        text = pending.text.trim()
        if (!text) return
        innerTemplate = messageInnerTemplate(text, at, plane, createdAt)
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
      try {
        if (pending.type === 'chest') {
          set({ deployNote: 'Signing and sealing the chest' })
          const sealed = await sealChest(pending, at, plane, createdAt)
          chest = sealed.chest
          forgedInside = sealed.forged
          innerTemplate = chestInnerTemplate(chest, at, plane, createdAt)
        }
        let rk: { key: Uint8Array; lookupId: string }
        if (route === 'cloud') {
          set({ deployNote: `HOSAKA has the 2^${deployHeight} key` })
          const held = await useSecrets.getState().buy(at, plane, deployHeight)
          if (!held) throw new Error(useSecrets.getState().buyError ?? 'HOSAKA could not compute the key.')
          rk = { key: hexToBytes(held.keyHex), lookupId: held.lookupId }
        } else {
          set({ deployNote: `Computing the 2^${deployHeight} key on this machine` })
          rk = await regionKeyOffThread(at, deployHeight, MAX_COMPUTE_HEIGHT)
        }
        set({ deployNote: 'Sealing and publishing' })
        const live = cs.live
        // A large shard is hidden by reference (spec §7.6, DECK-0003 §3.2): it
        // becomes its own kind 33331 object sealed with the same key, and the
        // bag carries only a tag naming it. The object goes out first, so a
        // published bag never names something the relay does not have.
        let inner: NostrEvent
        let ref: Reference | undefined
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
            let copy = await copyForLink(object)
            if (!copy.hint && !copy.deleted) { linkCopies.delete(object.id); copy = await copyForLink(object) }
            if (copy.deleted) throw new Error(LINK_DELETED)
            if (!copy.hint) throw new Error(LINK_REFUSED)
            hint = copy.hint
          }
          ref = referenceTo(inner, at, plane, hint)
        } else if (pending.type === 'shard' && shard && wantsReference(shard)) {
          inner = await cs.signEvent(await objectTemplate(shard, rk.key, placementId(), createdAt))
          if (live) {
            const sent = await publishMany(relaySet(), inner)
            if (!sent.ok) throw new Error('No relay took the shard. Try again when one is reachable.')
          }
          ref = referenceTo(inner, at, plane, relaySet()[0] ?? '')
          forgetReference(ref)
        } else {
          if (!innerTemplate) throw new Error('Nothing to hide.')
          inner = await cs.signEvent(innerTemplate)
        }
        let event: NostrEvent
        let published: boolean
        let settings: BagSettings
        try {
          const existing = await gatherInners(rk.lookupId, rk.key, live, deployHeight)
          const allInners = mergeEntries(existing.entries, [ref ?? inner])
          // What you changed in the deploy bar wins; what you left as it was
          // takes the bag's current value, which may be newer than what the
          // bar showed (resolveBagSettings). The controls were seeded from
          // this region's bag only if `deployBagFrom` names this region.
          const region = regionOf(at, plane, deployHeight)
          const base = deployBagFrom?.region === region ? deployBagFrom.settings : DEFAULT_BAG_SETTINGS
          settings = resolveBagSettings(deployBag, base, existing.settings, deployHeight)
          ;({ event, published } = await publishBag(allInners, rk.key, rk.lookupId, deployHeight, live, settings, { at, plane }))
        } catch (err) {
          // The object went out but no bag names it: take it back rather than
          // leave a preview on the relay that nothing will ever clean up.
          // Only an object this deploy published; never the author's, for a LIVE LINK.
          if (ref && live && !link) await retractObject(inner).catch(() => undefined)
          throw err
        }

        const item: MyDeployment = {
          // A LIVE LINK is keyed by its bag and entry (hidden.ts linkKey), as the scan keys it.
          eventId: link && ref ? linkKey(rk.lookupId, ref) : inner.id,
          inner,
          ref,
          bagId: event.id,
          type: pending.type,
          shard,
          text,
          key,
          chest,
          at: storedAt(at),
          plane,
          height: deployHeight,
          lookupId: rk.lookupId,
          keyHex: bytesToHex(rk.key),
          relays: relaySet(),
          createdAt,
          published,
          bag: settings,
        }
        // A key you hid is yours to hold at once, alone or inside a chest, so
        // chests can be sealed to it from here on (B1 §3.1).
        const place: HeldPlace = { lookupId: rk.lookupId, bagId: event.id, at: storedAt(at), plane, height: deployHeight }
        if (key) useInventory.getState().holdForged(inner, key, place)
        for (const f of forgedInside) useInventory.getState().holdForged(f.event, f.key, place)
        // Every item now in this region's bag shares its new envelope, status and settings.
        const mine = [
          ...get().mine.map((d) => (d.lookupId === rk.lookupId ? { ...d, bagId: event.id, published, bag: settings } : d)),
          item,
        ]
        // Only this deploy is finished. One lined up since (a DEPLOY from the
        // workshop while this was hiding) is a deploy of its own, and stays.
        if (get().pending === pending) set({ mine, deployStatus: 'done', pending: null, deployNote: null })
        else set({ mine })
        saveMine(mine)
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        if (get().pending === pending) set({ deployStatus: 'error', deployNote: null, deployError: reason })
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
    broadcast: async (lookupId) => {
      if (get().broadcasting) return false
      const items = get().mine.filter((d) => d.lookupId === lookupId)
      if (items.length === 0) return false
      set({ broadcasting: lookupId, broadcastError: null })
      try {
        const key = hexToBytes(items[0].keyHex)
        const existing = await gatherInners(lookupId, key, true, items[0].height)
        // Objects hidden by reference go out before the bag that names them,
        // and so do the authors' objects a LIVE LINK names: a finder looks
        // them up on the relays the bag goes to.
        const me = cyber().identity.pubkey
        const hinted = new Map<string, Reference>()
        for (const d of items) {
          if (!d.ref) continue
          const foreign = d.inner.pubkey !== me
          if (foreign && (isProtected({ event: d.inner }) || await authorDeleted({ pubkey: d.inner.pubkey, address: d.ref[1], id: d.inner.id, createdAt: d.inner.created_at }))) {
            set({ broadcasting: null, broadcastError: isProtected({ event: d.inner }) ? LINK_PROTECTED : LINK_DELETED })
            return false
          }
          // A bag naming an object no relay holds would be a permanent hole
          // for everyone, carried forward by every later rewrite. Stop here.
          const took = await republish(d.inner)
          if (!took) {
            set({ broadcasting: null, broadcastError: 'No relay took a shard this bag names. Try again when one is reachable.' })
            return false
          }
          // A LIVE LINK hidden while LOCAL named your first relay; now it names one that took the object.
          if (d.ref[0] === 'a' && d.ref[2] !== took) hinted.set(d.eventId, [d.ref[0], d.ref[1], took, ...d.ref.slice(3)] as Reference)
        }
        if (hinted.size > 0) {
          const mine = get().mine.map((d) => (hinted.has(d.eventId) ? { ...d, ref: hinted.get(d.eventId) } : d))
          set({ mine }); saveMine(mine)
        }
        const fresh = items.map((d) => (hinted.has(d.eventId) ? { ...d, ref: hinted.get(d.eventId) } : d))
        // The re-hinted entries replace the bag's older ones for the same placement.
        const keep = existing.entries.filter((e) => !fresh.some((d) => d.ref && entryKey(e) === entryKey(d.ref)))
        const allInners = mergeEntries(keep, fresh.map(entryOf))
        const settings = existing.settings ?? DEFAULT_BAG_SETTINGS
        const { event, published } = await publishBag(allInners, key, lookupId, items[0].height, true, settings, { at: positionOf(items[0]), plane: items[0].plane })
        if (!published) {
          set({ broadcasting: null, broadcastError: 'No relay took the bag. Try again when one is reachable.' })
          return false
        }
        const relays = relaySet()
        const mine = get().mine.map((d) => (d.lookupId === lookupId ? { ...d, bagId: event.id, published: true, relays, bag: settings } : d))
        set({ mine, broadcasting: null })
        saveMine(mine)
        return true
      } catch (err) {
        set({ broadcasting: null, broadcastError: err instanceof Error ? err.message : String(err) })
        return false
      }
    },

    /**
     * One region, asked for by name. The discovery scan sweeps the cubes you
     * stand in; this asks about a region you hold the key to but are nowhere
     * near, which is what the Secrets list is for.
     */
    rescan: async (lookupId, keyHex) => {
      set({ scanning: true })
      try {
        const events = await query({ kinds: [HIDDEN_KIND], '#d': [lookupId] })
        // The region's height, so a bag without `h` reads at its true size: a
        // held cube's height, or your own deployment's. A box key (one height
        // per axis) is not a cube and says nothing here; `h` then decides.
        const held = useSecrets.getState().keys[lookupId]
        const cube = held && (!held.heights || (held.heights.x === held.heights.y && held.heights.y === held.heights.z)) ? held.height : undefined
        const height = cube ?? get().mine.find((d) => d.lookupId === lookupId)?.height
        const found: Hidden[] = []
        for (const ev of events) found.push(...await unbag(ev, hexToBytes(keyHex), resolveReference, undefined, height))
        // What this scan opened for the first time gets the ceremony: the
        // decode in the scene and the chip that says how many.
        const fresh = get().freshOf(found)
        if (found.length > 0) get().addDiscovered(found)
        if (fresh.length > 0) useCeremony.getState().mark(fresh)
        return found.length
      } catch {
        return 0
      } finally {
        set({ scanning: false })
      }
    },

    deleteInstance: async (eventId) => {
      const item = get().mine.find((d) => d.eventId === eventId)
      if (!item) return
      const cs = cyber()
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
      const gathered = await gatherInners(item.lookupId, key, wasPublic, item.height)
      const gone = entryKey(entryOf(item))
      const left = gathered.entries.filter((e) => entryKey(e) !== gone)
      const me = cs.identity.pubkey

      let mine: MyDeployment[]
      // Whether the relays now hold a bag that no longer names this item.
      let unnamed = false
      if (left.length > 0) {
        // Rewrite the region bag without this item; the newer bag replaces it,
        // with the bag's settings as they stand.
        const settings = gathered.settings ?? DEFAULT_BAG_SETTINGS
        const { event, published } = await publishBag(left, key, item.lookupId, item.height, wasPublic, settings, { at: positionOf(item), plane: item.plane })
        unnamed = published
        mine = get().mine
          .filter((d) => d.eventId !== eventId)
          .map((d) => (d.lookupId === item.lookupId ? { ...d, bagId: event.id, published, bag: settings } : d))
      } else {
        // The last thing in the region: delete the envelope itself (NIP-09).
        if (wasPublic) {
          const del = await cs.signEvent({
            kind: 5,
            created_at: Math.floor(Date.now() / 1000),
            content: 'hidden content removed',
            // kind 33330 is addressable, so the address is what a relay
            // replaces and what NIP-09 asks for; the event id goes too, for
            // relays that only match that.
            tags: [['a', `${HIDDEN_KIND}:${me}:${item.lookupId}`], ['e', item.bagId], ['k', String(HIDDEN_KIND)]],
          })
          try { unnamed = (await publishMany(item.relays ?? relaySet(), del)).ok } catch { /* best effort */ }
        }
        mine = get().mine.filter((d) => d.eventId !== eventId)
      }
      // A shard hidden by reference is also its own event. Once no bag names
      // it, take that down too (NIP-09), if it is ours to take down: it is
      // sealed, but its preview would otherwise sit on the relay for good.
      // Only once the relays hold a bag that no longer names it: retracting it
      // while the old bag still does would leave that bag with a hole.
      if (item.ref && item.inner.pubkey === me && wasPublic && unnamed) {
        try { await retractObject(item.inner, item.relays ?? relaySet()) } catch { /* best effort */ }
        forgetReference(item.ref)
      }

      const deleted = { ...get().deleted, [eventId]: true as const }
      const discovered = { ...get().discovered }
      delete discovered[eventId]
      const wasInspecting = get().inspecting === eventId
      // The whole bag is gone only when nothing of ours is left in it. The
      // public list is a list of bags, so that is the grain it forgets at.
      const deletedBags = left.length > 0
        ? get().deletedBags
        : { ...get().deletedBags, [`${me}:${item.lookupId}`]: true as const }
      set({ mine, deleted, deletedBags, discovered, inspecting: wasInspecting ? null : get().inspecting })
      if (wasInspecting) cs.clearFocus()
      saveMine(mine); saveDeleted(deleted)
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
      const opener = openerFor(chest.chest, openingKeys(useInventory.getState().items), me)
      if (!opener) return 'Opening the chest needs the key it is sealed to, which this device does not hold.'
      let raw: BagEntry[]
      try {
        raw = opener.by === 'key' ? openWithSecret(chest.chest, opener.key.secretHex) : await openWithSigner(chest.chest, cs.decryptSealed)
      } catch (err) {
        return `The chest did not open: ${err instanceof Error ? err.message : String(err)}`
      }
      const resealed = resealWithout(chest.chest, raw, eventId)
      if (!resealed) return 'That is no longer inside this chest.'
      const at = positionOf(chest)
      const createdAt = Math.floor(Date.now() / 1000)
      const inner = await cs.signEvent(chestInnerTemplate(resealed.chest, at, chest.plane, createdAt))
      const key = hexToBytes(chest.keyHex)
      const wasPublic = get().mine.some((d) => d.lookupId === chest.lookupId && d.published)
      // The bag as it really is (gatherInners, as deleteInstance explains),
      // with the new chest in the old one's place; a bag that somehow lacked
      // the chest gets it added rather than lost.
      const gathered = await gatherInners(chest.lookupId, key, wasPublic, chest.height)
      const was = entryKey(entryOf(chest))
      const entries = gathered.entries.some((e) => entryKey(e) === was)
        ? gathered.entries.map((e) => (entryKey(e) === was ? inner : e))
        : [...gathered.entries, inner]
      const settings = gathered.settings ?? chest.bag ?? DEFAULT_BAG_SETTINGS
      const { event, published } = await publishBag(entries, key, chest.lookupId, chest.height, wasPublic, settings, { at, plane: chest.plane })
      // The chest is a new inner event now: the deployment, its record among
      // the finds and everything revealed from it follow the new id, and the
      // whole region's items follow the new envelope.
      const mine = get().mine.map((d) => {
        if (d.eventId === chest.eventId) return { ...d, eventId: inner.id, inner, chest: resealed.chest, createdAt, bagId: event.id, published, bag: settings }
        return d.lookupId === chest.lookupId ? { ...d, bagId: event.id, published, bag: settings } : d
      })
      const deleted = { ...get().deleted, [eventId]: true as const }
      const discovered: Record<string, Hidden> = {}
      for (const h of Object.values(get().discovered)) {
        if (h.eventId === eventId) continue
        if (h.eventId === chest.eventId) { discovered[inner.id] = { ...h, eventId: inner.id, inner, chest: resealed.chest, createdAt, bagId: event.id }; continue }
        if (h.chestId === chest.eventId) { discovered[h.eventId] = { ...h, chestId: inner.id, bagId: event.id }; continue }
        discovered[h.eventId] = h.author === me && h.lookupId === chest.lookupId ? { ...h, bagId: event.id } : h
      }
      // Seen already: the next scan finds the rewritten chest without a ceremony.
      remember([inner.id])
      set({ mine, deleted, discovered, selectedSecret: get().selectedSecret === eventId ? null : get().selectedSecret })
      saveMine(mine); saveDeleted(deleted)
      return null
    },

    inspect: (eventId) => set({ inspecting: eventId }),

    selectSecret: (eventId) => set({ selectedSecret: eventId }),

    addDiscovered: (items) => {
      if (items.length === 0) return
      const { deleted } = get()
      const discovered = { ...get().discovered }
      let changed = false
      for (const h of items) {
        if (deleted[h.eventId]) continue
        const held = discovered[h.eventId]
        // New, or a LIVE LINK whose author published a newer version: the
        // same find, refreshed, and no second ceremony (review of #233).
        const newer = !!held && !!h.inner && !!held.inner && h.inner.id !== held.inner.id && h.inner.created_at > held.inner.created_at
        if (!held || newer) { discovered[h.eventId] = h; changed = true }
      }
      // A chest that a held key opens is opened here, and what it holds is
      // found too, in place: the gate of B1. A room sealed behind a door
      // appears where the door stands the moment its key is in LOOT, on
      // every scan, and a key inside opens the next chest in the same pass.
      // A chest sealed to this identity waits for OPEN in the record, since a
      // signer may have to be asked.
      const keys: OpeningKey[] = openingKeys(useInventory.getState().items)
      const queue = items.filter((h) => h.type === 'chest' && h.chest)
      const revealed: Hidden[] = []
      while (queue.length > 0) {
        const door = queue.shift()!
        const opener = openerFor(door.chest!, keys, '')
        if (!opener || opener.by !== 'key') continue
        let inside: Hidden[]
        try { inside = revealedIn(door, readContents(openWithSecret(door.chest!, opener.key.secretHex))) } catch { continue }
        for (const r of inside) {
          if (deleted[r.eventId] || discovered[r.eventId]) continue
          discovered[r.eventId] = r
          revealed.push(r)
          changed = true
          if (r.type === 'chest' && r.chest) queue.push(r)
          if (r.type === 'key' && r.key) keys.push({ id: r.eventId, itemPubkey: r.key.itemPubkey, secretHex: r.key.secretHex })
        }
      }
      if (changed) set({ discovered })
      const all = [...items, ...revealed]
      remember(all.map((h) => h.eventId))
      claimOwn(all)
      // Reading a key is holding it (B1 §2.1): every key a scan opened goes
      // into the inventory, once, whoever hid it.
      useInventory.getState().holdFinds(all)
      // What a door revealed gets the find ceremony, as a scan's finds do.
      if (revealed.length > 0) useCeremony.getState().mark(revealed)
    },

    freshOf: (items) => {
      const { discovered, deleted, mine } = get()
      const own = new Set(mine.map((d) => d.eventId))
      return items.filter((h) => !discovered[h.eventId] && !deleted[h.eventId] && !own.has(h.eventId) && !seen.has(h.eventId))
    },

    setScanning: (scanning) => set({ scanning }),

    testDiscovery: async (eventId) => {
      const item = get().mine.find((d) => d.eventId === eventId)
      if (!item || !item.published) return 'missing'
      // Region key derived fresh from the coordinate, as a stranger would.
      const rk = regionKeyAt(positionOf(item), item.height, MAX_COMPUTE_HEIGHT)
      const events = await query({ kinds: [HIDDEN_KIND], '#d': [rk.lookupId] })
      let refused = false
      for (const ev of events) {
        const h = BigInt(item.height)
        const p = positionOf(item)
        const items = await unbag(ev, rk.key, resolveReference, { at: { x: (p.x >> h) << h, y: (p.y >> h) << h, z: (p.z >> h) << h }, plane: item.plane }, item.height)
        if (items.some((h) => h.eventId === eventId)) return 'found'
        // The bag opened and this item is in it, signed, yet unbag dropped it:
        // the format refused it, and every other client will too.
        if (!refused) refused = (await bagInners(ev, rk.key)).some((e) => e.id === eventId)
      }
      return refused ? 'refused' : 'missing'
    },

    pendingShard: () => {
      const { pending } = get()
      if (pending?.type !== 'shard') return null
      return pending.object?.shard ?? useWorkshop.getState().shards.find((s) => s.id === pending.shardId) ?? null
    },

    worldItems: () => {
      const out: WorldItem[] = []
      const seen = new Set<string>()
      const me = useCyberspace.getState().identity.pubkey
      for (const d of get().mine) {
        seen.add(d.eventId)
        out.push({ key: d.eventId, type: d.type, at: positionOf(d), plane: d.plane, height: d.height, mine: true, author: me, shard: d.shard, text: d.text, keyItem: d.key, chest: d.chest, createdAt: d.createdAt, lookupId: d.lookupId, bagId: d.bagId, target: itemTargetOf(d.inner, d.ref) })
      }
      for (const h of Object.values(get().discovered)) {
        if (seen.has(h.eventId)) continue
        out.push({ key: h.eventId, type: h.type, at: h.at, plane: h.plane, height: h.height, mine: false, author: h.author, shard: h.shard, text: h.text, keyItem: h.key, chest: h.chest, createdAt: h.createdAt, lookupId: h.lookupId, bagId: h.bagId, target: itemTargetOf(h.inner, h.ref), chestId: h.chestId })
      }
      return out
    },

    secretByEvent: (eventId) => get().worldItems().find((w) => w.key === eventId) ?? null,
  }
})

// The build STEP belongs to one deploy: when it ends, hidden or canceled, or
// another is lined up in its place, the step goes back to the zoom.
useShards.subscribe((s, prev) => {
  const cs = useCyberspace.getState()
  if (s.pending !== prev.pending && (cs.buildStep !== null || cs.buildSettle !== null)) cs.setBuildStep(null)
})

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __shards?: unknown }).__shards = useShards
}
