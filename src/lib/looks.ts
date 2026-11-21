/**
 * looks.ts: what a chest or a door looks like in the world (chest and door
 * design, D2, D3, R14; arkinox, 2026-10-26), and the `look` tag that says so
 * on the wire (DECK-0004 §3.6).
 *
 * A chest used to be the note's cube. It is now a model, placed like a
 * shard: its origin on the chest's place, at its true size. The built-in
 * looks, each with an open version that swaps in once this identity has
 * opened it (R14):
 *
 *   TREASURE  the owner's own treasure chest (treasure-chest-arkinox.json),
 *             closed, and open with the lid up and gold inside.
 *   CRAWL     the Maze Kit's 2 x 2 crawl door slab, closed and open.
 *   DOOR      the Maze Kit's 2 x 3 door slab, closed and open.
 *   HALL      the Maze Kit's 4 x 6 hall gate, closed and open.
 *
 * The models are the Maze Kit's files as built and checked there
 * (onosendai/chest-door/models/README.md), bundled with the app and read
 * once by sno-core like any payload.
 *
 * On the wire a look is a tag: `["look", payload]` closed and `["look",
 * payload, "open"]` open, each payload a SNO object exactly as a kind 3330
 * carries it (DECK-0003 §1.1). A built-in goes out as a small wrapper placing
 * its public object, posed by the hide bar's SCALE and TURN, the kind 33331 the
 * owner publishes at each address in DEFAULT_LOOK_DS (his ruling, 2026-11-01:
 * a look's bytes in every bag were what filled it). Another client fetches the
 * object. Here an exact match on one of the eight addresses is the bundled file,
 * with no fetch and no relay asked (expandDefault), and from there on a real
 * model: its walls, its lid and its drawing are as they were. A custom look of
 * up to MAX_LOOK_BYTES stays inline, and an inline look of any shape is still
 * read. A larger one is a SEALED LOOK (DECK-0004 §3.6, "A look sealed as its own
 * event"): its own kind 33331 hidden object, sealed with the key of the bag that
 * holds the chest exactly as a large shard is (lib/hidden.ts objectTemplateOf),
 * and the tag carries a small wrapper placing it. lookOf opens it with that
 * bag's key once it is fetched (sealedLookState), and draws the chest without
 * that look until then. A chest written before looks has none, and wears
 * TREASURE, or DOOR when it is a door.
 *
 * A door is a chest that carries a `door` tag (DECK-0004 §3.7). Every chest
 * without one is a chest.
 *
 * THE SEAM: `lookOf`. Everything that draws a chest or a door asks it, and
 * it reads the `look` tags first (lookTagsOf), then the built-in. `lid` is
 * TREASURE's alone: by its address when it goes by reference, by its exact
 * shape for one written inline before that. Turned, it has none: the hinge is
 * only ever applied to a look whose lid is known.
 */

import { MAX_UNIT, fromPayload, ticksOf, toPayload, type ShardModel } from 'sno-core/shards'
import { parseAddress } from 'sno-core/parts'
import { hexToBytes, type NostrEvent } from './events'
import { ALGO, decryptForRegion } from './shardCrypto'
import { verifyOnce } from './verifiedSigs'
import { keepOwnTable } from './carried'
import { turnDirection, turnShard, type Turns } from './turn'
import { chosenConstrainOf, withConstrain, type Constrain } from './walkConstrain'
import chestClosed from './looks/chest.json'
import chestOpen from './looks/chest-open.json'
import crawlClosed from './looks/door-crawl.json'
import crawlOpen from './looks/door-crawl-open.json'
import doorClosed from './looks/door-standard.json'
import doorOpen from './looks/door-standard-open.json'
import hallClosed from './looks/door-hall.json'
import hallOpen from './looks/door-hall-open.json'

/** The built-in looks. */
export type LookName = 'treasure' | 'crawl' | 'door' | 'hall'

/** The built-in looks a door offers on the hide bar, in its model row's order (D2). */
export const DOOR_LOOKS: readonly LookName[] = ['crawl', 'door', 'hall']

/** The built-in looks a chest offers (the chest model ruling). */
export const CHEST_LOOKS: readonly LookName[] = ['treasure']

/** What a look wears: a chest, or a door. */
export type LookKind = 'chest' | 'door'

/** A look: what is drawn while closed, and once opened (null: an opened look is not drawn at all). */
export interface Look {
  /** A built-in, or `custom`: read from the thing's own `look` tags. */
  name: LookName | 'custom'
  /** Whether a chest or a door wears it: what OPEN plays, and whether an opened look with no open version is drawn (§3.6). */
  kind: LookKind
  closed: ShardModel
  open: ShardModel | null
  /** The closed look cut into its body and its lid, with the lid's hinge: the built-in TREASURE's alone. */
  lid?: Lid
}

/**
 * Where a lid turns: a line along X through (y, z) in the model's render
 * frame (model units, as sno-core toRender draws it), and how far it turns
 * up and back to stand as the open look's lid stands, radians about +X.
 */
export interface LidHinge {
  y: number
  z: number
  angle: number
}

/** A closed look as two models: everything but the lid, and the lid. */
export interface Lid {
  body: ShardModel
  lid: ShardModel
  hinge: LidHinge
}

/**
 * The treasure chest's lid: every face wholly at or above 62 ticks (0.52
 * gibson), where the body's walls end and the arch begins
 * (chest-door/models/README.md). The gold band crosses that height and stays
 * with the body.
 */
export const TREASURE_LID_CUT = 62
/**
 * The hinge along the back of the gold band, at its top (64 ticks) and its
 * back face (51.5 ticks behind the middle; the lock plate is at the front,
 * +Z, and the render frame's Z is the wire's, sno-core negating it once
 * into the model and once out), the lid turned 100 degrees up and back:
 * fitted against the owner's open model, where 82 of the lid's 90 points
 * land within two ticks of the open lid's (looks.test.ts).
 */
export const TREASURE_HINGE: LidHinge = { y: 64 / 120, z: -51.5 / 120, angle: -(100 * Math.PI) / 180 }

/**
 * Cut a model in two at a height: the faces whose every corner is at or
 * above `cutTicks` (in Y, the model's own ticks), and the rest, each with
 * only its own points (a point is drawn as a dot, so a shared one would be
 * drawn twice) and its own face colours.
 */
export function splitAt(shard: ShardModel, cutTicks: number): { below: ShardModel; above: ShardModel } {
  const up = shard.vertices.map((v) => ticksOf(v)[1] >= cutTicks)
  const part = (above: boolean, suffix: string): ShardModel => {
    const map = new Map<number, number>()
    const vertices: ShardModel['vertices'] = []
    const faces: ShardModel['faces'] = []
    const facecolors: NonNullable<ShardModel['facecolors']> = []
    shard.faces.forEach((f, i) => {
      if (f.every((k) => up[k]) !== above) return
      faces.push(f.map((k) => {
        let n = map.get(k)
        if (n === undefined) { n = vertices.length; map.set(k, n); vertices.push(shard.vertices[k]) }
        return n
      }) as [number, number, number])
      if (shard.facecolors) facecolors.push(shard.facecolors[i])
    })
    return { ...shard, id: `${shard.id}:${suffix}`, vertices, faces, ...(shard.facecolors ? { facecolors } : {}) }
  }
  return { below: part(false, 'body'), above: part(true, 'lid') }
}

/** The tag that marks a chest as a door (DECK-0004 §3.7). */
export const DOOR_TAG = 'door'

/** A height as a bag writes one: a decimal string, no sign, no leading zeros (CYBERSPACE_V2.md §8.6); a door's is at least 1. */
const DOOR_HEIGHT_RE = /^[1-9][0-9]*$/

/**
 * A chest's door height (DECK-0004 §3.7.1): the number in its one `door`
 * tag; null when it carries no `door` tag (a chest); `malformed` when the
 * tag is there but its height is not a well-formed height of at least 1,
 * or there is more than one `door` tag. A reader MUST drop a malformed door
 * (lib/hidden.ts chestItemOf), never read it as a chest or as a door.
 */
export function doorHeightOf(tags: readonly unknown[] | undefined): number | null | 'malformed' {
  if (!tags) return null
  const doors = tags.filter((t): t is unknown[] => Array.isArray(t) && t[0] === DOOR_TAG)
  if (doors.length === 0) return null
  if (doors.length > 1) return 'malformed'
  const h = doors[0][1]
  if (typeof h !== 'string' || !DOOR_HEIGHT_RE.test(h) || h.length > 3) return 'malformed'
  return Number(h)
}

/** Whether a chest's tags mark it a door: exactly one `door` tag with a well-formed height (§3.7.1). */
export function isDoor(tags: readonly unknown[] | undefined): boolean {
  return typeof doorHeightOf(tags) === 'number'
}

const PAYLOADS: Record<LookName, { closed: unknown; open: unknown; kind: LookKind }> = {
  treasure: { closed: chestClosed, open: chestOpen, kind: 'chest' },
  crawl: { closed: crawlClosed, open: crawlOpen, kind: 'door' },
  door: { closed: doorClosed, open: doorOpen, kind: 'door' },
  hall: { closed: hallClosed, open: hallOpen, kind: 'door' },
}

/** What each built-in is called on the hide bar's model row. */
export const LOOK_LABELS: Readonly<Record<LookName, string>> = { treasure: 'TREASURE', crawl: 'CRAWL', door: 'DOOR', hall: 'HALL' }

/** Who publishes the eight default models. */
export const DEFAULT_LOOK_AUTHOR = 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a'

/** Each default's `d`, as the real import names them from maze-kit-locks.zip (lib/shardZip.ts kitIds; lookDefaults.test.ts). */
export const DEFAULT_LOOK_DS: Readonly<Record<LookName, { closed: string; open: string }>> = {
  treasure: { closed: 'maze-kit/locks/chests/chest/chest', open: 'maze-kit/locks/chests/chest/chest-open' },
  crawl: { closed: 'maze-kit/locks/doors/door-crawl/door-crawl', open: 'maze-kit/locks/doors/door-crawl/door-crawl-open' },
  door: { closed: 'maze-kit/locks/doors/door-standard/door-standard', open: 'maze-kit/locks/doors/door-standard/door-standard-open' },
  hall: { closed: 'maze-kit/locks/doors/door-hall/door-hall', open: 'maze-kit/locks/doors/door-hall/door-hall-open' },
}

export const defaultLookAddress = (d: string): string => `33331:${DEFAULT_LOOK_AUTHOR}:${d}`

/** The eight addresses, and which bundled file each one is. */
export const DEFAULT_LOOK_ADDRESSES: ReadonlyMap<string, { name: LookName; part: 'closed' | 'open' }> = new Map(
  (Object.keys(DEFAULT_LOOK_DS) as LookName[]).flatMap((name) => (['closed', 'open'] as const).map((part) => [defaultLookAddress(DEFAULT_LOOK_DS[name][part]), { name, part }] as const)),
)

/** A default model as this client holds it: which it is, and the wrapper that says so on the wire. */
interface DefaultLook { name: LookName; part: 'closed' | 'open'; wrapper: ShardModel; turned: boolean; turns: Turns }
const defaultOf = new WeakMap<ShardModel, DefaultLook>()

/** A wrapper placing one model at its origin, at its own size (the FEED wrapper's shape, useShards feedWrapper). */
function wrapperOf(model: ShardModel, address: string): ShardModel {
  return {
    id: `look:${address}`, name: model.name, unit: model.unit, extent: model.extent, mode: 'solid',
    vertices: [], faces: [], up: false, spin: 0, updatedAt: 0,
    refs: [['a', address]],
    parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }],
  }
}

const cache = new Map<LookName, Look>()

/** A built-in look, read once and shared by every chest that wears it. */
export function builtInLook(name: LookName): Look {
  const held = cache.get(name)
  if (held) return held
  const p = PAYLOADS[name]
  const closed = fromPayload(p.closed, `look:${name}`)
  if (!closed) throw new Error(`the built-in ${name} look does not parse`)
  const look: Look = { name, kind: p.kind, closed, open: fromPayload(p.open, `look:${name}:open`) }
  if (name === 'treasure') look.lid = treasureLid(closed)
  for (const part of ['closed', 'open'] as const) {
    const model = look[part]
    if (model) defaultOf.set(model, { name, part, wrapper: wrapperOf(model, defaultLookAddress(DEFAULT_LOOK_DS[name][part])), turned: false, turns: [0, 0, 0] })
  }
  cache.set(name, look)
  return look
}

/** The treasure chest's closed look cut into its body and its lid, with the hinge. */
function treasureLid(closed: ShardModel): Lid {
  const { below, above } = splitAt(closed, TREASURE_LID_CUT)
  return { body: below, lid: above, hinge: TREASURE_HINGE }
}

/** The tag a look rides in (DECK-0004 §3.6). */
export const LOOK_TAG = 'look'

/**
 * The largest look ONOSENDAI carries in a `look` tag, in bytes of its payload:
 * past it, a shard is hidden by reference instead of inline (lib/hidden.ts
 * REFERENCE_THRESHOLD_BYTES), since a look in its tag rides in every rewrite of
 * its bag (§3.6 Size). A larger look goes as a sealed look, up to the size limit
 * of its own event (lib/sealedLooks.ts sealedLookLimit).
 */
export const MAX_LOOK_BYTES = 16_384

const bytesOf = (s: string): number => new TextEncoder().encode(s).length

/** Why a look of this many bytes is refused against a size limit (MAX_LOOK_BYTES, a look in its tag, unless said), in words, or null when it fits. */
export function lookRefusal(bytes: number, limit: number = MAX_LOOK_BYTES): string | null {
  if (bytes <= limit) return null
  return `This model is over the size limit: ${bytes.toLocaleString('en-US')} of ${limit.toLocaleString('en-US')} bytes.`
}

/** One look tag's payload read as a model, or null: malformed, over MAX_LOOK_BYTES, or refused by the format (DECK-0003 §1.9). */
const parsed = new Map<string, ShardModel | null>()
const PARSED_MAX = 256
function readLookPayload(payload: string): ShardModel | null {
  if (parsed.has(payload)) return parsed.get(payload)!
  // Too large is refused before it is kept: a key this size in the cache would hold what the limit refuses.
  if (bytesOf(payload) > MAX_LOOK_BYTES) return null
  let model: ShardModel | null = null
  try { model = fromPayload(JSON.parse(payload), `look:${payload.length}:${payload.slice(-16)}`) } catch { model = null }
  if (parsed.size >= PARSED_MAX) parsed.delete(parsed.keys().next().value as string)
  parsed.set(payload, model)
  return model
}

/** One object per model and author, so whatever keys on a model's identity (geometry, measures) holds across reads. */
const owned = new WeakMap<ShardModel, Map<string | null, ShardModel>>()
function ownedLook(model: ShardModel, author: string | null): ShardModel {
  let byAuthor = owned.get(model)
  if (!byAuthor) owned.set(model, byAuthor = new Map())
  let held = byAuthor.get(author)
  if (!held) byAuthor.set(author, held = keepOwnTable(model, author))
  return held
}

/** Every way a wrapper's one placement can be turned, as the bar writes it (turnShard), found by asking. */
let partTurns: Map<string, Turns> | null = null
function turnsOfPart(turn: unknown): Turns | null {
  if (!partTurns) {
    partTurns = new Map()
    const blank = wrapperOf(builtInLook('door').closed, 'table')
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) {
      const key = JSON.stringify(turnShard(blank, [x, y, z]).parts?.[0].turn)
      if (!partTurns.has(key)) partTurns.set(key, [x, y, z])
    }
  }
  return partTurns.get(JSON.stringify(turn)) ?? null
}

/**
 * A wrapper of exactly one default model, as that model posed: the bundled file,
 * so nothing is fetched and no relay is asked, and walls and a lid have a real
 * model to read (a wrapper's `constrain` does not reach what it places, §1.12).
 * Null for anything else: more than one placement, a placement moved off the
 * origin or carrying anything but its step and turn, a turn that is not quarter
 * turns, a size past the limit, or any other address. Those are ordinary wrappers,
 * fetched as any other. Its WALK is the wrapper's when it says, else the model's.
 */
const expanded = new WeakMap<ShardModel, ShardModel | null>()
function expandDefault(w: ShardModel): ShardModel | null {
  const held = expanded.get(w)
  if (held !== undefined) return held
  let out: ShardModel | null = null
  const part = w.parts?.length === 1 ? w.parts[0] : null
  const ref = w.refs?.length === 1 ? w.refs[0] : null
  const hit = ref && ref[0] === 'a' ? DEFAULT_LOOK_ADDRESSES.get(String(ref[1])) : undefined
  const plain = !!part && part.ref === 0 && part.at.every((n) => n === 0) && Object.keys(part).every((k) => k === 'ref' || k === 'at' || k === 'turn' || k === 'step')
  if (hit && part && plain && w.vertices.length === 0 && w.faces.length === 0 && !w.objects) {
    const base = builtInLook(hit.name)[hit.part]
    const turns = turnsOfPart(part.turn)
    const unit = (base?.unit ?? 0) + part.step
    if (base && turns && unit >= 0 && unit <= MAX_UNIT) {
      const shaped: ShardModel = { ...turnShard(base, turns), id: w.id, unit, up: w.up, spin: w.spin }
      const chosen = chosenConstrainOf(w)
      out = chosen ? withConstrain(shaped, chosen) : shaped
      defaultOf.set(out, { name: hit.name, part: hit.part, wrapper: { ...w, unit }, turned: turns.some((t) => t % 4 !== 0), turns })
    }
  }
  expanded.set(w, out)
  return out
}

/** A thing's own looks, read from its tags: each null when it carries no well-formed one. */
export interface LookTags {
  closed: ShardModel | null
  open: ShardModel | null
  /** A sealed look among them is still being fetched, or could not be: read again once sealedLooksVersion moves. */
  pending?: boolean
}

/**
 * A SEALED LOOK (DECK-0004 §3.6, "A look sealed as its own event"): a look in
 * its tag whose only content is one placement, at the origin, unturned, at its
 * own size, of a kind 33331 event of the chest's own signer, which is a hidden
 * object (DECK-0003 §3.4) sealed with the key of the bag that holds the chest.
 * Its address when `model` has that shape and `author` signed the chest, else
 * null. A built-in's address is never one (expandDefault has it). Whether the
 * event is sealed or public is known only once it is fetched: a public one is an
 * ordinary placement (a FEED look of your own object), drawn as before.
 */
export function sealedLookAddress(model: ShardModel, author: string | null): string | null {
  if (!author || model.vertices.length !== 0 || model.faces.length !== 0 || model.objects) return null
  const ref = model.refs?.length === 1 ? model.refs[0] : null
  const part = model.parts?.length === 1 ? model.parts[0] : null
  if (!ref || ref[0] !== 'a' || !part || part.ref !== 0 || part.step !== 0) return null
  if (!part.at.every((n) => n === 0) || !part.turn.every((n) => n === 0)) return null
  if (!Object.keys(part).every((k) => k === 'ref' || k === 'at' || k === 'turn' || k === 'step')) return null
  const address = String(ref[1])
  const a = parseAddress(address)
  if (!a || a.kind !== 33331 || a.pubkey !== author || DEFAULT_LOOK_ADDRESSES.has(address)) return null
  return address
}

/** Fetches the event a sealed look's ref names (store/useShards wires lib/references.ts resolveReference), or null. */
export type SealedLookFetch = (ref: string[]) => Promise<NostrEvent | null>
let sealedFetch: SealedLookFetch | null = null

/** How sealed looks are fetched, or null to fetch none (each then reads as missing). */
export function setSealedLookFetch(fetch: SealedLookFetch | null): void {
  sealedFetch = fetch
}

/** Where one sealed look stands, under one bag key. */
export type SealedLookState =
  | { state: 'loading' }
  | { state: 'ready'; model: ShardModel; bytes: number }
  /** The event is a public object: the look is an ordinary placement. */
  | { state: 'public' }
  | { state: 'missing'; at: number }

/**
 * Sealed looks opened, by address and bag key, oldest first. Bounded as the
 * parsed cache above is: at most PARSED_MAX of them, and at most
 * SEALED_LOOKS_KEPT_BYTES of decrypted payload, the most PARSED_MAX looks of
 * MAX_LOOK_BYTES each could hold there, so sealing a look holds no more than
 * the cache of tags already could. Only the model is kept, never the payload.
 * The newest is always kept: one sealed look's event is far under the budget
 * (lib/sealedLooks.ts sealedLookLimit), and a Look read from it holds its model
 * for as long as its chest's tags are held.
 */
const sealedLooks = new Map<string, SealedLookState>()
const SEALED_LOOKS_MAX = 256
export const SEALED_LOOKS_KEPT_BYTES = SEALED_LOOKS_MAX * MAX_LOOK_BYTES
let sealedBudget = SEALED_LOOKS_KEPT_BYTES
let sealedBytes = 0
/** How long a sealed look that could not be had stays missing before it is asked for again: lib/references.ts keeps a miss as long. */
const SEALED_RETRY_MS = 60_000
let sealedVersion = 0
const sealedListeners = new Set<() => void>()

/** Moves whenever a sealed look lands or turns out missing: whoever drew a chest without one draws it again. */
export function sealedLooksVersion(): number {
  return sealedVersion
}

/** Hear of sealedLooksVersion moving (useSyncExternalStore); the return stops it. */
export function onSealedLooks(listener: () => void): () => void {
  sealedListeners.add(listener)
  return () => { sealedListeners.delete(listener) }
}

function sizeOf(s: SealedLookState): number {
  return s.state === 'ready' ? s.bytes : 0
}

function dropSealed(key: string): void {
  const was = sealedLooks.get(key)
  if (!was) return
  sealedLooks.delete(key)
  sealedBytes -= sizeOf(was)
}

function keepSealed(key: string, s: SealedLookState): void {
  dropSealed(key)
  sealedLooks.set(key, s)
  sealedBytes += sizeOf(s)
  for (const [k] of sealedLooks) {
    if (k === key || (sealedLooks.size <= SEALED_LOOKS_MAX && sealedBytes <= sealedBudget)) break
    dropSealed(k)
  }
}

function sealedChanged(): void {
  sealedVersion++
  for (const l of sealedListeners) l()
}

/** Forget every sealed look opened, and say how many there were: on a change of identity, and in tests, where `budget` sets the byte bound. */
export function forgetSealedLooks(budget: number = SEALED_LOOKS_KEPT_BYTES): number {
  const n = sealedLooks.size
  sealedLooks.clear()
  sealedBytes = 0
  sealedBudget = budget
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; retryAt = Infinity }
  // Whatever was drawn from one reads again (under the new identity's keys).
  if (n > 0) sealedChanged()
  return n
}

/** What the sealed look cache holds now: for tests and the memory checks. */
export function sealedLooksKept(): { count: number; bytes: number } {
  return { count: sealedLooks.size, bytes: sealedBytes }
}

/**
 * One sealed look under one bag key: ready, public, missing, or loading, in
 * which case it is fetched now (once) and opened with `keyHex`. The event must
 * verify, be the one the address names, and open with the bag's key; it is then
 * read as a look in its tag is (DECK-0003 §1.9), its table under its signer,
 * who is the chest's (§3.6, Reading a sealed look). Anything else is missing:
 * the chest is drawn without that look, and never as the preview.
 */
export function sealedLookState(address: string, keyHex: string, hint?: string): SealedLookState {
  const key = `${address}|${keyHex}`
  const held = sealedLooks.get(key)
  if (held && !(held.state === 'missing' && Date.now() - held.at >= SEALED_RETRY_MS)) {
    // Asked again: last out.
    if (held.state !== 'loading') { sealedLooks.delete(key); sealedLooks.set(key, held) }
    return held
  }
  if (!sealedFetch) return { state: 'missing', at: Date.now() }
  const loading: SealedLookState = { state: 'loading' }
  keepSealed(key, loading)
  void openSealedLook(address, keyHex, hint, sealedFetch).then((next) => {
    // Asked again meanwhile, whatever holds the key now stands. Pushed out of
    // the cache while it loaded (or forgotten), whoever waits on it asks again.
    if (sealedLooks.get(key) !== loading) { if (!sealedLooks.has(key)) sealedChanged(); return }
    keepSealed(key, next)
    // A look that could not be had is asked for again once its minute is up: whoever drew the chest without it reads again then.
    if (next.state === 'missing') retryLater()
    sealedChanged()
  })
  return loading
}

let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryAt = Infinity
/** The least a wake-up waits: what is due is read again by then, not woken for again and again. */
const RETRY_MIN_MS = 1000
/**
 * One wake-up, when the earliest missing sealed look's minute is up: whoever
 * drew a chest without it reads again then. Firing, it sets the next for the
 * earliest still missing, so a look that went missing later is asked for again
 * in its own time (review).
 */
function retryLater(): void {
  let earliest = Infinity
  for (const s of sealedLooks.values()) if (s.state === 'missing') earliest = Math.min(earliest, s.at + SEALED_RETRY_MS)
  if (earliest === Infinity || (retryTimer && earliest >= retryAt)) return
  if (retryTimer) clearTimeout(retryTimer)
  retryAt = earliest
  retryTimer = setTimeout(() => {
    retryTimer = null
    retryAt = Infinity
    sealedChanged()
    // Due ones are being read again now; one not yet due wakes in its own time.
    let next = Infinity
    for (const s of sealedLooks.values()) if (s.state === 'missing' && s.at + SEALED_RETRY_MS > Date.now()) next = Math.min(next, s.at + SEALED_RETRY_MS)
    if (next !== Infinity) { retryAt = next; retryTimer = setTimeout(() => { retryTimer = null; retryAt = Infinity; sealedChanged(); retryLater() }, Math.max(RETRY_MIN_MS, next - Date.now())) }
  }, Math.max(RETRY_MIN_MS, earliest - Date.now()))
}

async function openSealedLook(address: string, keyHex: string, hint: string | undefined, fetch: SealedLookFetch): Promise<SealedLookState> {
  const missing: SealedLookState = { state: 'missing', at: Date.now() }
  try {
    const a = parseAddress(address)
    if (!a) return missing
    const ev = await fetch(['a', address, hint ?? ''])
    if (!ev || ev.kind !== a.kind || ev.pubkey !== a.pubkey || ev.tags.find((t) => t[0] === 'd')?.[1] !== a.d || !verifyOnce(ev)) return missing
    const enc = ev.tags.find((t) => t[0] === 'encrypted')
    if (!enc) return { state: 'public' }
    if (enc[1] !== ALGO || !enc[2]) return missing
    const plain = await decryptForRegion(hexToBytes(keyHex), enc[2])
    if (plain === null) return missing
    let model: ShardModel | null = null
    try { model = fromPayload(JSON.parse(plain), `look:${address}`) } catch { model = null }
    if (!model) return missing
    return { state: 'ready', model: ownedLook(model, a.pubkey), bytes: bytesOf(plain) }
  } catch {
    return missing
  }
}

/**
 * The `look` tags of a chest or a door (§3.6), chosen by shape before any
 * payload is read: a tag is well-formed when its second element is a
 * string and it has exactly two elements (a closed look), or exactly three
 * with `open` as the third (an open look); the first well-formed tag of each counts, and every
 * other `look` tag is ignored, one whose third element is a word not known
 * among them. Only then is each counted payload checked (DECK-0003 §1.9, and
 * MAX_LOOK_BYTES here): one that fails is no look of that kind, never a fall
 * back to a later tag, and never a reason to drop the chest. `author` is the
 * chest's (or door's) verified signer, the only key whose carried objects
 * count (DECK-0003 §1.10, lib/carried.ts keepOwnTable); null, for an
 * unsigned chest, honours no key. `keyHex`, the key of the bag that holds the
 * chest, opens a sealed look (§3.6): until it is fetched, or when it cannot be
 * had, that look reads as absent and `pending` says so. Without a key a sealed
 * look's wrapper is read as it is, as before.
 */
export function lookTagsOf(tags: readonly unknown[] | undefined, author: string | null = null, keyHex?: string): LookTags {
  const out: LookTags = { closed: null, open: null }
  if (!tags) return out
  let closed: string | null = null
  let open: string | null = null
  for (const t of tags) {
    if (!Array.isArray(t) || t[0] !== LOOK_TAG || typeof t[1] !== 'string') continue
    if (t.length === 2) closed ??= t[1]
    else if (t.length === 3 && t[2] === 'open') open ??= t[1]
  }
  let pending = false
  const read = (payload: string | null): ShardModel | null => {
    const model = payload === null ? null : readLookPayload(payload)
    if (!model) return null
    const builtIn = expandDefault(model)
    if (builtIn) return builtIn
    const address = keyHex ? sealedLookAddress(model, author) : null
    if (address && keyHex) {
      const hint = model.refs?.[0]?.[2]
      const s = sealedLookState(address, keyHex, typeof hint === 'string' ? hint : undefined)
      if (s.state === 'ready') return s.model
      if (s.state !== 'public') { pending = true; return null }
    }
    return ownedLook(model, author)
  }
  return { closed: read(closed), open: read(open), ...(pending ? { pending } : {}) }
}

/** What lookOf reads: a chest, and its event's tags (and signer, and signature) when known, and the key of the bag that holds it, which opens a sealed look. */
export interface LookSubject {
  type: string
  event?: { tags: readonly unknown[]; pubkey?: string; sig?: string } | null
  bagKeyHex?: string
}

/** Whose carried objects a look's table honours: the chest event's signer when it is signed, else nobody (§3.6, DECK-0003 §1.10). */
function lookAuthor(event: LookSubject['event']): string | null {
  return event?.pubkey && event.sig ? event.pubkey : null
}

/** Whether a model is the built-in TREASURE's shape exactly, at any unit: its lid is then known. */
export function isTreasureShape(model: ShardModel): boolean {
  const t = builtInLook('treasure').closed
  if (model.vertices.length !== t.vertices.length || model.faces.length !== t.faces.length) return false
  for (let i = 0; i < t.vertices.length; i++) {
    const a = ticksOf(model.vertices[i]), b = ticksOf(t.vertices[i])
    if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) return false
  }
  return model.faces.every((f, i) => f[0] === t.faces[i][0] && f[1] === t.faces[i][1] && f[2] === t.faces[i][2])
}

/** A look read from its tags, the bag key it was read with, and, while a sealed look in it is pending, the sealedLooksVersion it was read at. */
const custom = new WeakMap<readonly unknown[], { look: Look; keyHex?: string; version: number | null }>()

/**
 * The look a chest or a door wears, or null for anything else: its own
 * `look` tags first (§3.6), else the built-in, TREASURE for a chest and DOOR
 * for a door. A custom closed look with no open one has none: an opened
 * DOOR is then not drawn at all, and only an opened chest keeps its closed
 * look (drawnLook). A custom open look with no closed one is drawn over the
 * built-in closed one ("with no closed look, a reader draws whatever it
 * draws for a chest"). Read once per tag list and bag key, and again once a
 * sealed look in it lands (§3.6: drawn without it while it is fetched).
 */
export function lookOf(item: LookSubject): Look | null {
  if (item.type !== 'chest') return null
  const tags = item.event?.tags
  const kind: LookKind = isDoor(tags) ? 'door' : 'chest'
  const builtIn = builtInLook(kind === 'door' ? 'door' : 'treasure')
  if (!tags || !tags.some((t) => Array.isArray(t) && t[0] === LOOK_TAG)) return builtIn
  const keyHex = item.bagKeyHex
  const held = custom.get(tags)
  if (held && held.keyHex === keyHex && (held.version === null || held.version === sealedVersion)) return held.look
  const own = lookTagsOf(tags, lookAuthor(item.event), keyHex)
  let look: Look
  if (!own.closed && !own.open) look = builtIn
  else if (!own.closed) look = { ...builtIn, name: 'custom', kind, open: own.open, lid: undefined }
  else {
    look = { name: 'custom', kind, closed: own.closed, open: own.open }
    // TREASURE by reference, by its address and unturned; one written inline before that, by its shape.
    const known = defaultOf.get(own.closed)
    if (kind === 'chest' && (known ? known.name === 'treasure' && known.part === 'closed' && !known.turned : isTreasureShape(own.closed))) look.lid = treasureLid(own.closed)
  }
  custom.set(tags, { look, keyHex, version: own.pending ? sealedVersion : null })
  return look
}

/**
 * Which way a look faces, as a turn about Y in its own frame (radians, as
 * three's rotation.y): the side its lid opens toward and its lock plate is
 * on. The built-in TREASURE faces +Z (TREASURE_HINGE: the lock plate at the
 * front, the lid leaning back to -Z), so 0 is +Z. A default model by
 * reference carries the hide bar's TURN, baked into its points (lib/turn.ts),
 * and faces where that TURN sent its front: the open look's TURN first, since
 * the loot floats out of the open chest, else the closed one's. A look with
 * no notion of a front (an inline model, a MINE or FEED model, whose TURN is
 * baked in with nothing left to read it from) follows TREASURE's convention
 * and faces +Z. A TURN that tips the front straight up or down (011, 013,
 * 031, 033 ...: the chest lying on its back or its face) leaves no side it
 * faces, and its width, always level then, says the way instead: the facing
 * that runs the row along the chest's width as turned, so the loot lies
 * across the chest, not along its height (review of #638); untipped, that is
 * +Z, as before. What floats out of an opened chest
 * lines up across this front and faces it (scene/ChestLoot; arkinox,
 * 2026-11-09: "the chest is opened from the front so the items should be in
 * a line facing the front of the chest").
 */
export function lookFacing(look: Pick<Look, 'closed' | 'open'>): number {
  const known = (look.open && defaultOf.get(look.open)) || defaultOf.get(look.closed)
  if (!known) return 0
  // The TURN turns the points as stored, whose Z is the render frame's negated (TREASURE_HINGE): render +Z is stored -Z, and back.
  const [x, , z] = turnDirection([0, 0, -1], known.turns)
  if (x !== 0 || z !== 0) return Math.atan2(x, -z)
  // The front up or down: the row (ChestLoot's X, turned by the facing to render (cos, -sin)) along the
  // width (+X, as stored and as rendered) as turned, its render direction (wx, -wz). `+ 0` makes -0 a 0.
  const [wx, , wz] = turnDirection([1, 0, 0], known.turns)
  return Math.atan2(wz, wx) + 0
}

/**
 * How a look stands, by its own payload's `up` and `spin` (§3.6, DECK-0003
 * §1.7): on the ground where it is placed, in dataspace, as a hidden shard
 * does. Undefined: on cyberspace axes as built.
 */
export function lookStand<P>(model: Pick<ShardModel, 'up' | 'spin'>, plane: number, at: P): { at: P; spin: number } | undefined {
  return model.up && plane === 0 ? { at, spin: model.spin } : undefined
}

/** How a look goes out from the hide bar: its size, its quarter turns and its WALK setting, as a shard's do. */
export interface LookPose {
  unit: number
  turn: Turns
  constrain: Constrain
}

/**
 * A model posed by the bar, its WALK aside: turned (lib/turn.ts), at the bar's
 * unit, on cyberspace axes (the bar offers no snap, so whatever the model stood
 * as on the bench does not come along). A wrapper, a look of placements alone,
 * is scaled by its placements' steps, since a placed object is drawn at its own
 * unit plus the step (DECK-0003 §1.10) and the wrapper's unit says nothing of it.
 */
function posedShape(model: ShardModel, pose: Pick<LookPose, 'unit' | 'turn'>): ShardModel {
  const turned = turnShard(model, pose.turn)
  const by = pose.unit - model.unit
  const parts = by !== 0 && turned.vertices.length === 0 && turned.parts ? turned.parts.map((p) => ({ ...p, step: p.step + by })) : turned.parts
  return { ...turned, ...(parts ? { parts } : {}), unit: pose.unit, up: false, spin: 0 }
}

/** A model posed for the wire: posedShape, with the bar's WALK setting. */
export function posedLook(model: ShardModel, pose: LookPose): ShardModel {
  return withConstrain(posedShape(model, pose), pose.constrain)
}

/**
 * An open look posed alike, so it stands exactly where the closed one stood.
 * The bar's WALK reaches one that has a setting (a chest's); one with none (a
 * built-in slab's) keeps none, so an opened door holds nobody.
 */
export function posedOpenLook(model: ShardModel, pose: LookPose): ShardModel {
  const shape = posedShape(model, pose)
  return chosenConstrainOf(model) === undefined ? shape : withConstrain(shape, pose.constrain)
}

/** A FEED wrapper posed: its WALK setting is its object's author's, and the wrapper writes none (DECK-0003 §1.12). */
export function posedWrapper(model: ShardModel, pose: Pick<LookPose, 'unit' | 'turn'>): ShardModel {
  return posedShape(model, pose)
}

/**
 * A closed look as it goes out: a default model by reference, posed from the
 * wrapper it came from, or any other as posedLook writes it inline.
 */
export function wireLook(model: ShardModel, pose: LookPose): ShardModel {
  const known = defaultOf.get(model)
  return known ? withConstrain(posedShape(known.wrapper, pose), pose.constrain) : posedLook(model, pose)
}

/**
 * An open look as it goes out, posed alike. The bar's WALK reaches a default that
 * can hold a walker (TREASURE open), and never one authored `off`: an opened door
 * holds nobody, whatever the closed one was set to.
 */
export function wireOpenLook(model: ShardModel, pose: LookPose): ShardModel {
  const known = defaultOf.get(model)
  if (!known) return posedOpenLook(model, pose)
  const shape = posedShape(known.wrapper, pose)
  return chosenConstrainOf(builtInLook(known.name).open ?? model) === 'off' ? shape : withConstrain(shape, pose.constrain)
}

/**
 * A look as tags (§3.6): the closed look, and the open one when there is
 * one, each the payload a kind 3330 would carry. Throws with lookRefusal's
 * words when either is over `limit`, so the hide bar and the seal refuse the
 * same way: MAX_LOOK_BYTES, what a tag carries, unless the caller seals a
 * larger one as its own event (lib/sealedLooks.ts), which passes its limit.
 */
export function lookTags(closed: ShardModel, open: ShardModel | null, limit: number = MAX_LOOK_BYTES): string[][] {
  const out: string[][] = []
  for (const [model, extra] of [[closed, []], [open, ['open']]] as const) {
    if (!model) continue
    const payload = JSON.stringify(toPayload(model))
    const refusal = lookRefusal(bytesOf(payload), limit)
    if (refusal) throw new Error(refusal)
    out.push([LOOK_TAG, payload, ...extra])
  }
  return out
}

/** The bytes of a model as a look's payload: what MAX_LOOK_BYTES is measured against. */
export function lookBytes(model: ShardModel): number {
  return bytesOf(JSON.stringify(toPayload(model)))
}

/**
 * A built-in look as it goes out: closed and open, each a wrapper of its public
 * object, both posed alike (wireLook, wireOpenLook).
 */
export function builtInLookTags(name: LookName, pose: LookPose): string[][] {
  const look = builtInLook(name)
  return lookTags(wireLook(look.closed, pose), look.open ? wireOpenLook(look.open, pose) : null)
}

/** A point, as a world item's place is. */
interface At { x: bigint; y: bigint; z: bigint }

/**
 * Whether a thing that came out of an opened chest stays in the chest: it is
 * listed under the chest's rows and floats out as loot, and is not drawn in
 * the world (DECK-0004 §3.4: "a chest's contents are taken, not placed"; a
 * hider who wants things to appear where they stand uses a door, and CONVERT
 * TO DOOR moves an old room-chest behind one, R13). Anything out of a chest,
 * wherever it was aimed. A thing whose chest is not known is drawn, as
 * before; a door's room never comes this way.
 */
export function keptInChest(item: { chestId?: string; at: At }, parent: { at: At; tags?: readonly unknown[] } | undefined): boolean {
  return !!item.chestId && !!parent && !isDoor(parent.tags)
}

/**
 * Whether OPEN (or CLOSE, `closing`) has a model to swap, so a ceremony draws
 * the change: a look with an open version other than its closed one; or a door
 * with none, which fades away as it opens (§3.6: an opened door with no open
 * look is not drawn). A chest with no open version keeps its one model, exactly
 * as drawn, through the opening and after it, with nothing faded, remounted or
 * fetched (arkinox, 2026-11-18: "a custom chest only has 1 model"); and a door
 * with none simply stands again as it closes.
 */
export function swapsOnOpen(look: Pick<Look, 'kind' | 'closed' | 'open'>, closing = false): boolean {
  if (look.open && look.open !== look.closed) return true
  return look.kind === 'door' && !closing
}

/**
 * The model drawn for a look (§3.6 Drawing it): the closed one until opened;
 * once opened, the open one when there is one, else nothing for a door (an
 * opened door with no open look is not drawn at all) and the closed one for
 * a chest, which alone keeps its closed look.
 */
export function drawnLook(look: Look, opened: boolean): ShardModel | null {
  if (!opened) return look.closed
  if (look.open) return look.open
  // A door with no open look is not drawn once opened; a chest keeps its closed look (§3.6).
  return look.kind === 'door' ? null : look.closed
}
