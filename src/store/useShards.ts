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
import { clampUnit, normalizeStored } from 'sno-core/shards'
import { snapOffered, wrapSpin } from '../lib/pose'
import { create } from 'zustand'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from './useCyberspace'
import { publishMany, query, queryEach, relaySet } from '../lib/relay'
import { forgetReference, resolveReference } from '../lib/references'
import { unbagRemembered } from '../lib/foundCache'
import { itemTargetOf, type ItemTarget } from '../lib/comments'
import { bytesToHex, hexToBytes, type EventTemplate, type NostrEvent } from '../lib/events'
import { regionKeyAt } from '../lib/shardCrypto'
import { regionKeyOffThread } from '../lib/regionKeyOffThread'
import { signedTableOnly } from '../lib/carried'
import { deployCeiling, deployRoute, localKeyCeiling, needsAsk, regionKeyQuote } from '../lib/deployPlan'
import { useSecrets } from './useSecrets'
import {
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
  OBJECT_KIND,
  dOf,
  editedTemplate,
  itemLineage,
  referenceTo,
  wantsReference,
  type BagEntry,
  type Reference,
  type Rumor,
  chestInnerTemplate,
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
  isReference,
} from '../lib/hidden'
import { retractionTemplate } from '../lib/published'
import { audioInnerTemplate, fadeAt, type AudioItem } from '../lib/audioItem'
import { resealCopy } from '../lib/audioFile'
import { openWithSecret, openWithSigner, openerFor, readContents, resealWithout, revealedIn, sealEntries, sealedInside, sealerOf, type ChestEntry, type OpeningKey } from '../lib/chests'
import { openedByHand, restoreOpened } from './useOpenedChests'
import { openingKeys, placeOf, type HeldItem, type HeldPlace, type InChest } from '../lib/inventory'
import { useInventory } from './useInventory'
import { useShardFolders } from './useShardFolders'
import { creditOf, useWorkshop } from './useWorkshop'
import { deletionFilters, isDeleted, type Credit, type FeedObject } from 'sno-core/feed'
import { builtInLook, builtInLookTags, keptInChest, lookTags, posedLook, type LookName, type LookPose } from '../lib/looks'
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
  /** The envelope currently holding it; changes when the bag is rewritten. */
  bagId: string
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
  /** A new key forged inline, for chaining: it is held by you the moment the chest is hidden. */
  | { kind: 'key'; key: KeyItem }
  /** Hidden audio, its file already encrypted and uploaded (AudioCompose): sealed in at the chest's place. */
  | { kind: 'audio'; audio: AudioItem }

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

/** What a chest wears when nothing else is chosen. */
export const DEFAULT_CHEST_LOOK: LookChoice = { from: 'builtin', name: 'treasure' }

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
  if (choice.from === 'feed') return lookTags(posedLook(feedWrapper(choice.object, pose.unit), pose), null)
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
  | { type: 'message'; text: string }
  /** A key forged in the composer: the keypair is made there, so its public key can be shown and sealed to before it is hidden. */
  | { type: 'key'; key: KeyItem }
  /** `look`: what it wears (the hide bar's model row); absent, the built-in TREASURE. */
  | ({ type: 'chest'; look?: LookChoice } & ChestDraft)
  /**
   * Hidden audio (DECK-0007): the file is encrypted and on Blossom already
   * (AudioCompose); the item is sealed as a rumor. With `reseal` it is PLACE
   * AGAIN's copy: the deploy seals the file again under a fresh key and
   * uploads it before it hides the item, so no two placements share a key.
   * `server` is the Blossom server the hider picked for the first upload,
   * where a copy goes too: a server may answer with a URL on another host.
   */
  | { type: 'audio'; audio: AudioItem; reseal?: true; server?: string }

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
    case 'message': return findCashuToken(pending.text) === null
    case 'key': return false
    case 'chest': return false
    case 'audio': return true
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

/** Why an EDIT stopped: the shard it moves is no longer among your deployments here. */
export const EDIT_GONE = 'That shard is no longer among what this device hid, so there is nothing to move.'
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
    default: return shard?.name ?? 'shard'
  }
}

/** Whether a pending deploy has nothing in it to hide. */
export function pendingEmpty(pending: DeployPending, shard: ShardModel | null): boolean {
  switch (pending.type) {
    case 'message': return pending.text.trim().length === 0
    case 'key': return pending.key.name.trim().length === 0
    case 'chest': return pending.name.trim().length === 0 || pending.contents.length === 0
    case 'audio': return !pending.audio.url
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
  const items = mine.filter((d) => regionOf(positionOf(d), d.plane, d.height) === region)
  if (items.length === 0) return null
  const newest = items.reduce((a, b) => (b.createdAt > a.createdAt ? b : a))
  return { region, settings: { ...DEFAULT_BAG_SETTINGS, ...(newest.bag ?? {}) }, count: items.length, cashu: items.some((d) => d.inner.kind === MESSAGE_KIND && findCashuToken(d.inner.content) !== null) }
}

/** How long the upload of PLACE AGAIN's fresh audio copy waits on the signer: a person reads the prompt. */
const AUDIO_SIGN_PATIENCE_MS = 60_000

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
  /** Hide audio the composer encrypted and uploaded (DECK-0007). */
  startDeployAudio: (audio: AudioItem, opts?: { server?: string; reseal?: boolean }) => void
  /** The FADE stepper: the pending audio's full-volume sphere (a one-shot's trigger zone), in gibsons; undefined for the default, half the way to the wall. */
  setDeployFade: (fade: number | undefined) => void
  /** Hide a chest as the composer drafted it; its contents are signed (the aimed ones already are) and sealed when it is hidden. */
  startDeployChest: (draft: ChestDraft & { lock: ChestLock }) => void
  /** The hide bar's model row: what the chest being hidden wears. SCALE and WALK start from that model's own. */
  setDeployLook: (look: LookChoice) => void
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
   * there, because a bag need not carry `H` (spec §8.6).
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
   * coordinate, ask the relays, open what comes back. `refused` means the bag
   * came back and this item is in it, but the format refuses it, so no client
   * can show it; the fix is in the workshop, not on the relay.
   */
  testDiscovery: (eventId: string) => Promise<'found' | 'missing' | 'refused'>
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

  /** Take down an object hidden by reference (NIP-09), once no bag names it. The same deletion RETRACT sends for a public object (lib/published.ts). */
  async function retractObject(object: NostrEvent, relays: string[] = relaySet()): Promise<void> {
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
  function rekeyTo(eventId: string, back: NostrEvent): MyDeployment | null {
    let row: MyDeployment | null = null
    const mine = get().mine.map((d) => {
      if (d.eventId !== eventId) return d
      const { putBack: _done, ...rest } = d
      row = { ...rest, eventId: back.id, inner: back }
      return row
    })
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
    set({ mine, discovered, selectedSecret: get().selectedSecret === eventId ? back.id : get().selectedSecret })
    saveMine(mine)
    return row
  }

  /** Put a failed move's old version back now (MyDeployment `putBack`): the row as it stands after, or null while no relay takes it. */
  async function putBackNow(eventId: string): Promise<MyDeployment | null> {
    const d = get().mine.find((m) => m.eventId === eventId)
    if (!d?.putBack) return d ?? null
    if (!(await publishRetried(d.putBack))) return null
    return rekeyTo(eventId, d.putBack)
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
   * the keys held here (lib/chests.ts sealedInside) and from what this
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
  async function publishBag(inners: BagEntry[], key: Uint8Array, lookupId: string, height: number, live: boolean, settings: BagSettings, place: { at: Position; plane: Plane }, beforeSend?: () => Promise<void>, before: BagEntry[] = []): Promise<{ event: NostrEvent; published: boolean }> {
    const looked = [...inners, ...before]
    const inside = sealedInside(looked, openingKeys(useInventory.getState().items))
    const chests = new Set(looked.filter((e): e is NostrEvent => !isReference(e) && e.kind === CHEST_KIND).map((e) => e.id))
    for (const h of Object.values(get().discovered)) if (h.chestId && chests.has(h.chestId)) inside.add(h.eventId)
    const entries = inside.size > 0 ? inners.filter((e) => !inside.has(entryKey(e))) : inners
    if (entries.length < inners.length) {
      const mine = get().mine.filter((d) => !(d.lookupId === lookupId && inside.has(entryKey(entryOf(d)))))
      if (mine.length < get().mine.length) { set({ mine }); saveMine(mine) }
    }
    const createdAt = nextBagAt(lookupId)
    const event = await cyber().signEvent(await bagTemplate(entries, key, lookupId, height, createdAt, HIDDEN_KIND, settings, place))
    // Anything that must go out only once the bag is signed (an EDIT's
    // resealed object): a signer that refuses the bag stops it here.
    if (beforeSend) await beforeSend()
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
      // What came out of a chest is the chest's, not an entry of the bag:
      // claimed, it was written into the bag beside the chest at the next
      // rewrite, readable by anyone with the region key (arkinox,
      // 2026-10-20: "chest contents should not be shown on TV").
      if (h.chestId) continue
      if (h.author !== me || !h.inner || !h.keyHex || have.has(h.eventId) || deleted[h.eventId]) continue
      have.add(h.eventId)
      own.push({
        eventId: h.eventId, inner: h.inner, ref: h.ref, bagId: h.bagId, type: h.type, shard: h.shard, text: h.text, key: h.key, chest: h.chest, audio: h.audio,
        at: storedAt(h.at), plane: h.plane, height: h.height, lookupId: h.lookupId, keyHex: h.keyHex,
        relays: relaySet(), createdAt: h.createdAt, published: true, bag: h.bag,
      })
    }
    if (own.length === 0 && !refreshed) return
    const next = [...updated, ...own]
    set({ mine: next })
    saveMine(next)
  }

  /** A look's own size and WALK setting, where SCALE and WALK start when it is picked. */
  function lookStart(look: LookChoice): { deployUnit: number; deployConstrain: Constrain } {
    const model = lookModelOf(look)
    return { deployUnit: model?.unit ?? 0, deployConstrain: model ? authoredConstrainOf(model) : CONSTRAIN_DEFAULT }
  }

  /** The same fresh-deploy state every start shares: no pose, no link, the bag settings at their defaults. */
  const freshDeploy = {
    deployLink: false, deployHeightAuto: false, deployUnit: 0, deployUp: false, deploySpin: 0, deployTurn: [0, 0, 0] as Turns, deployFollow: false, deployConstrain: CONSTRAIN_DEFAULT,
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
    const signed: Rumor[] = []
    const forged: Array<{ event: NostrEvent; key: KeyItem }> = []
    for (const c of draft.contents) {
      if (c.kind === 'message') {
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
        signed.push(await cs.signEvent(shardInnerTemplate(model, at, plane, createdAt, creditOf(model))))
      } else if (c.kind === 'audio') {
        // A rumor, as in a bag (DECK-0007 §3): the chest's signature vouches for it.
        signed.push(rumorOf(audioInnerTemplate(c.audio, at, plane, createdAt), cs.identity.pubkey))
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
    deployAsk: null,
    deployError: null,
    mine: loadMine(),
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
      if (get().deployStatus === 'working') return
      // A shard being aimed into a chest gives the chest back as it was: the
      // composer reopens with the draft intact and that shard as before.
      const { pending } = get()
      const chestBack = pending?.type === 'shard' && pending.intoChest ? pending.intoChest.draft : null
      // From the workshop, CANCEL goes back to the workshop (useBuilder).
      const workshopBack = asked && pending?.type === 'shard' && pending.from === 'workshop' ? pending.shardId : null
      set({ pending: null, deployStatus: 'idle', deployError: null, deployNote: null, deployAsk: null, chestBack, ...(workshopBack ? { workshopBack } : {}) })
    },
    confirmDeploy: () => { set({ deployAsk: null }); void get().deploy(true) },
    declineDeploy: () => set({ deployAsk: null }),

    deploy: async (confirmed = false) => {
      const { pending, deployHeight, deployUnit, deployUp, deploySpin, deployTurn, deployConstrain, deployBag, deployBagFrom, deployLink } = get()
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
      // An earlier move of it that could not be put back is put back first.
      if (was?.putBack) {
        // Working from here, so a second tap waits as for any hide.
        set({ deployStatus: 'working', deployError: null, deployNote: 'Putting the old version back' })
        const back = await putBackNow(was.eventId)
        if (!back) {
          set({ deployStatus: 'error', deployNote: null, deployError: PUT_BACK_PENDING })
          return
        }
        set({ deployStatus: 'idle', deployNote: null })
        was = back
      }

      // Where the key comes from. Above this machine's ceiling it is HOSAKA's,
      // priced from its region key ladder (lib/deployPlan.ts regionKeyLadder),
      // and the Cloud compute panel's mode says whether to ask first.
      const inputs = { localMax: localKeyCeiling(), cloudMode: cs.cloudPrefs.mode, cloudCap: cs.cloud.limits?.max_hop_height ?? null }
      const route = deployRoute(deployHeight, inputs)
      if (route === 'cloud' && !intoChest) {
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
      let forgedInside: Array<{ event: NostrEvent; key: KeyItem }> = []
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
        // The WALK setting goes out like the size (DECK-0003 §1.12): the same
        // object when it is unchanged, so an untouched deploy stays untouched.
        if (!link) shard = withConstrain(shard, deployConstrain)
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
        key = { ...pending.key, name: pending.key.name.trim(), about: pending.key.about.trim() }
        innerTemplate = keyInnerTemplate(key, at, plane, createdAt)
      } else if (pending.type === 'chest') {
        // Signed and sealed inside the try below: the contents are signed by
        // the identity, which may be a remote signer, and the bar shows it.
        if (!pending.name.trim() || pending.contents.length === 0 || !pending.lock) return
      } else if (pending.type === 'audio') {
        if (!pending.audio.url) return
        // The sphere is set at the ghost; where it really lands it is clamped to the room it has there (never out of the hide region).
        const fade = fadeAt(pending.audio.fade, at, deployHeight)
        const { fade: _old, ...rest } = pending.audio
        void _old
        audio = { ...rest, ...(fade !== undefined ? { fade } : {}), title: pending.audio.title.trim() || 'audio', about: pending.audio.about.trim() }
        // A copy's template waits for its fresh key, inside the try below.
        if (!pending.reseal) innerTemplate = audioInnerTemplate(audio, at, plane, createdAt)
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
          // What it wears, posed by the bar (DECK-0004 §3.6), before anything is sealed.
          const look = lookTagsFor(pending.look ?? DEFAULT_CHEST_LOOK, { unit: deployUnit, turn: deployTurn, constrain: deployConstrain })
          const sealed = await sealChest(pending, at, plane, createdAt)
          chest = { ...sealed.chest, look }
          forgedInside = sealed.forged
          innerTemplate = chestInnerTemplate(chest, at, plane, createdAt)
        }
        if (pending.type === 'audio' && pending.reseal && audio) {
          // PLACE AGAIN's copy: its own key, its own ciphertext (repeatable).
          set({ deployNote: 'Encrypting a fresh copy of the file' })
          audio = { ...audio, ...(await resealCopy(audio, (t) => cs.signEvent(t, AUDIO_SIGN_PATIENCE_MS), pending.server)) }
          innerTemplate = audioInnerTemplate(audio, at, plane, createdAt)
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
        // A move of something already on the relays goes to the relays, LOCAL
        // or not, as a DELETE does: leaving the old version up while the new
        // one stays here would show it in two places, or in the old one only.
        const live = cs.live || (was?.published ?? false)
        // A large shard is hidden by reference (spec §7.6, DECK-0003 §3.2): it
        // becomes its own kind 33331 object sealed with the same key, and the
        // bag carries only a tag naming it. The object goes out first, so a
        // published bag never names something the relay does not have.
        let inner: NostrEvent
        let ref: Reference | undefined
        // EDIT of a reference shard: the old object signed again, for a failed move to put back.
        let rollback: NostrEvent | undefined
        let objectSent = false
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
        } else if (pending.type === 'shard' && shard && (was ? !!was.ref : wantsReference(shard))) {
          // A move reseals the same object under its own `d`, which replaces
          // it on the relays and keeps its address, the thing its comments
          // and reactions name (arkinox, 2026-10-16).
          // A row from before a move made elsewhere would reseal the old
          // model over the moved one: refused (review of #369).
          if (was && live) {
            const still = await addressStillThis(referenced(was.inner))
            if (still !== 'this') throw new Error(still === 'newer' ? EDIT_STALE : EDIT_UNANSWERED)
          }
          // Newer than the version it replaces even within the same second
          // (a retry right after a rollback), or relays would keep that one.
          const objectAt = was ? Math.max(createdAt, was.inner.created_at + 1) : createdAt
          inner = await cs.signEvent(await objectTemplate(shard, rk.key, was ? dOf(was.inner) : placementId(), objectAt))
          if (was && live) {
            // A move publishes nothing until everything is signed: the
            // object goes out after the bag is signed (publishBag's
            // beforeSend), and the old version, signed again a second newer,
            // is what goes back if the new bag reaches no relay, so a failed
            // move never leaves the old place unreadable (review of #369).
            // Only while live: LOCAL publishes nothing, so there is nothing to put back.
            rollback = await cs.signEvent({ kind: was.inner.kind, created_at: objectAt + 1, content: was.inner.content, tags: was.inner.tags })
          } else if (live) {
            const sent = await publishMany(relaySet(), inner)
            if (!sent.ok) throw new Error('No relay took the shard. Try again when one is reachable.')
          }
          ref = referenceTo(inner, at, plane, relaySet()[0] ?? '')
          forgetReference(ref)
        } else {
          if (!innerTemplate) throw new Error('Nothing to hide.')
          // A message is sealed as a rumor and never goes to the signer: a
          // signed one lifted out of the bag would show anywhere as your own
          // public note (arkinox, 2026-10-20). Hidden audio is too, or a copy
          // would show as your own file post with the key to play it
          // (DECK-0007 §3). The bag's signature vouches for both.
          // Typed as the signed event the rest of this path carries; a rumor
          // only ever goes into the bag as its entry, never out on its own.
          inner = pending.type === 'message' || pending.type === 'audio' ? rumorOf(innerTemplate, cs.identity.pubkey) as NostrEvent : await cs.signEvent(innerTemplate)
        }
        let event: NostrEvent
        let published: boolean
        let settings: BagSettings
        try {
          const existing = await gatherInners(rk.lookupId, rk.key, live, deployHeight)
          // A move inside its own bag replaces the old entry in the same rewrite.
          const gone = was && was.lookupId === rk.lookupId ? entryKey(entryOf(was)) : null
          const allInners = mergeEntries(gone ? existing.entries.filter((e) => entryKey(e) !== gone) : existing.entries, [ref ?? inner])
          // What you changed in the deploy bar wins; what you left as it was
          // takes the bag's current value, which may be newer than what the
          // bar showed (resolveBagSettings). The controls were seeded from
          // this region's bag only if `deployBagFrom` names this region.
          const region = regionOf(at, plane, deployHeight)
          const base = deployBagFrom?.region === region ? deployBagFrom.settings : DEFAULT_BAG_SETTINGS
          settings = resolveBagSettings(deployBag, base, existing.settings, deployHeight)
          const sendObject = was && rollback && live
            ? async () => {
              const sent = await publishMany(relaySet(), inner)
              if (!sent.ok) throw new Error('No relay took the moved shard. It stays where it was.')
              objectSent = true
            }
            : undefined
          ;({ event, published } = await publishBag(allInners, rk.key, rk.lookupId, deployHeight, live, settings, { at, plane }, sendObject, existing.entries))
          // A move whose new bag no relay took has not happened: the old
          // copy stays, and is never taken down (review of #369).
          if (was && live && !published) throw new Error('No relay took the moved shard. It stays where it was.')
        } catch (err) {
          // Put back, the row follows: the relays now hold the rollback, so it
          // is this device's version of the shard, keyed by its id as a scan
          // keys a sealed object, or every later EDIT and DELETE of it would
          // read as stale (review of #369).
          // If no relay takes it even after retries, the row keeps it to put
          // back on its next EDIT, DELETE or BROADCAST, and says so.
          if (objectSent && rollback && was) {
            const back = rollback
            if (await publishRetried(back)) rekeyTo(was.eventId, back)
            else {
              const id = was.eventId
              const mine = get().mine.map((d) => (d.eventId === id ? { ...d, putBack: back } : d))
              set({ mine })
              saveMine(mine)
              throw new Error(PUT_BACK_PENDING)
            }
          }
          // The object went out but no bag names it: take it back rather than
          // leave a preview on the relay that nothing will ever clean up.
          // Only an object this deploy published; never the author's, for a LIVE LINK.
          // Never after a move: the object under that `d` is the only one.
          if (ref && live && !link && !was) await retractObject(inner).catch(() => undefined)
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
        }
        // A key you hid is yours to hold at once, alone or inside a chest, so
        // chests can be sealed to it from here on (B1 §3.1).
        const place: HeldPlace = { lookupId: rk.lookupId, bagId: event.id, at: storedAt(at), plane, height: deployHeight }
        if (key) useInventory.getState().holdForged(inner, key, place)
        for (const f of forgedInside) useInventory.getState().holdForged(f.event, f.key, place)
        // Every item now in this region's bag shares its new envelope, status and settings.
        const mine = [
          ...get().mine
            // Moved inside its bag: the old version left with the rewrite above.
            .filter((d) => !(was && was.lookupId === rk.lookupId && d.eventId === was.eventId))
            .map((d) => (d.lookupId === rk.lookupId ? { ...d, bagId: event.id, published, bag: settings } : d)),
          item,
        ]
        set({ mine })
        saveMine(mine)
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
              settings: { deployHeight, deployHeightAuto: s.deployHeightAuto, deployUnit, deployUp, deploySpin, deployTurn: [...deployTurn] as Turns, deployFollow: s.deployFollow, deployLink },
              step: cs.buildStep, spot, count: s.placedLast?.pending === pending ? s.placedLast.count + 1 : 1,
            }
            : s.placedLast
          const bag = again ? { deployBag: settings, deployBagFrom: ownBagIn(s.mine, regionOf(at, plane, deployHeight)) } : {}
          set({ deployStatus: 'done', pending: again, deployNote: null, deployAsk: null, placedLast, ...bag })
        }
        if (moveError) useToast.getState().show({ label: 'MOVED, OLD COPY STAYED', meta: `It stands at the new place; the old one could not be taken down (${moveError}). Tap it and DELETE it.`, mark: 'build' })
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
      for (const d of get().mine.filter((m) => m.lookupId === lookupId && m.putBack)) {
        if (!(await putBackNow(d.eventId))) { set({ broadcastError: PUT_BACK_PENDING, broadcastFailed: lookupId }); return false }
      }
      const items = get().mine.filter((d) => d.lookupId === lookupId)
      if (items.length === 0) return false
      set({ broadcasting: lookupId, broadcastError: null, broadcastFailed: null })
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
        if (hinted.size > 0) {
          const mine = get().mine.map((d) => (hinted.has(d.eventId) ? { ...d, ref: hinted.get(d.eventId) } : d))
          set({ mine }); saveMine(mine)
        }
        const fresh = items.map((d) => (hinted.has(d.eventId) ? { ...d, ref: hinted.get(d.eventId) } : d))
        // The re-hinted entries replace the bag's older ones for the same placement.
        const keep = existing.entries.filter((e) => !fresh.some((d) => d.ref && entryKey(e) === entryKey(d.ref)))
        const allInners = mergeEntries(keep, fresh.map(entryOf))
        const settings = existing.settings ?? DEFAULT_BAG_SETTINGS
        const { event, published } = await publishBag(allInners, key, lookupId, items[0].height, true, settings, { at: positionOf(items[0]), plane: items[0].plane }, undefined, existing.entries)
        if (!published) {
          set({ broadcasting: null, broadcastError: 'No relay took the bag. Try again when one is reachable.', broadcastFailed: lookupId })
          return false
        }
        const relays = relaySet()
        const mine = get().mine.map((d) => (d.lookupId === lookupId ? { ...d, bagId: event.id, published: true, relays, bag: settings } : d))
        set({ mine, broadcasting: null })
        saveMine(mine)
        return true
      } catch (err) {
        set({ broadcasting: null, broadcastError: err instanceof Error ? err.message : String(err), broadcastFailed: lookupId })
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
        // The region's height, so a bag without `H` reads at its true size: a
        // held cube's height, or your own deployment's. A box key (one height
        // per axis) is not a cube and says nothing here; `H` then decides.
        const held = useSecrets.getState().keys[lookupId]
        const cube = held && (!held.heights || (held.heights.x === held.heights.y && held.heights.y === held.heights.z)) ? held.height : undefined
        const height = cube ?? get().mine.find((d) => d.lookupId === lookupId)?.height
        const found: Hidden[] = []
        for (const ev of events) found.push(...await unbagRemembered(ev, hexToBytes(keyHex), resolveReference, undefined, height))
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
        const { event, published } = await publishBag(left, key, item.lookupId, item.height, wasPublic, settings, { at: positionOf(item), plane: item.plane }, undefined, gathered.entries)
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
      set({ mine, deleted, deletedBags, discovered })
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
      const { event, published } = await publishBag(entries, key, chest.lookupId, chest.height, wasPublic, settings, { at, plane: chest.plane }, undefined, gathered.entries)
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
      const byHand = (h: Hidden): boolean => h.type === 'chest' && !!h.chest && openedByHand(me, h.eventId, h.chest.lockPubkey)
      const queue = watched ? [] : items.filter(byHand)
      const revealed: Hidden[] = []
      while (queue.length > 0) {
        const door = queue.shift()!
        const opener = openerFor(door.chest!, keys, '')
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
    for (const d of state.mine) {
      seen.add(d.eventId)
      out.push({ key: d.eventId, type: d.type, at: positionOf(d), plane: d.plane, height: d.height, mine: true, author: me, shard: d.shard, text: d.text, keyItem: d.key, chest: d.chest, audio: d.audio, createdAt: d.createdAt, lookupId: d.lookupId, bagId: d.bagId, target: itemTargetOf(d.inner, d.ref), event: d.inner as NostrEvent, ...lineageOf(d.inner, d.ref) })
    }
    for (const h of Object.values(state.discovered)) {
      if (seen.has(h.eventId)) continue
      out.push({ key: h.eventId, type: h.type, at: h.at, plane: h.plane, height: h.height, mine: false, author: h.author, shard: h.shard, text: h.text, keyItem: h.key, chest: h.chest, audio: h.audio, createdAt: h.createdAt, lookupId: h.lookupId, bagId: h.bagId, target: itemTargetOf(h.inner, h.ref), chestId: h.chestId, event: h.inner as NostrEvent | undefined, ...lineageOf(h.inner, h.ref) })
    }
    return out
  }
})

// The build STEP belongs to one deploy: when it ends, hidden or canceled, or
// another is lined up in its place, the step goes back to the zoom. A
// placement lined up again (`placedLast`) keeps it, as it keeps every other
// setting.
useShards.subscribe((s, prev) => {
  const cs = useCyberspace.getState()
  const again = s.pending !== null && s.pending === s.placedLast?.pending
  if (s.pending !== prev.pending && !again && (cs.buildStep !== null || cs.buildSettle !== null)) cs.setBuildStep(null)
})

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __shards?: unknown }).__shards = useShards
}
