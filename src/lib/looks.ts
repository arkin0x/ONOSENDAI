/**
 * looks.ts: what a chest or a door looks like in the world (chest and door
 * design, D2, D3, R14; arkinox, 2026-10-26), and the `look` tag that says so
 * on the wire (DECK-0004 §3.6, cyberspace PR #82, not yet merged).
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
 * carries it (DECK-0003 §1.1). A built-in goes out the same way, posed by
 * the hide bar's SCALE, TURN and WALK, so every reader draws it; nothing
 * about a look is ONOSENDAI's own. A chest written before looks has none,
 * and wears TREASURE, or DOOR when it is a door.
 *
 * A door is a chest that carries a `door` tag (DECK-0004 §3.7). Every chest
 * without one is a chest.
 *
 * THE SEAM: `lookOf`. Everything that draws a chest or a door asks it, and
 * it reads the `look` tags first (lookTagsOf), then the built-in. `lid` is
 * the built-in TREASURE's alone, and a custom closed look whose shape is
 * exactly TREASURE's (the built-in, sealed at any SCALE but never turned)
 * keeps it: the hinge is only ever applied to a look whose lid is known.
 */

import { fromPayload, ticksOf, toPayload, type ShardModel } from 'sno-core/shards'
import { keepOwnTable } from './carried'
import { turnShard, type Turns } from './turn'
import { withConstrain, type Constrain } from './walkConstrain'
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
 * The largest look ONOSENDAI reads or writes, in bytes of its payload: past
 * it, a shard is hidden by reference instead of inline (lib/hidden.ts
 * REFERENCE_THRESHOLD_BYTES), and a look rides inline in every rewrite of its
 * bag (§3.6 Size).
 */
export const MAX_LOOK_BYTES = 16_384

const bytesOf = (s: string): number => new TextEncoder().encode(s).length

/** Why a look of this many bytes is refused, in words, or null when it fits. */
export function lookRefusal(bytes: number): string | null {
  if (bytes <= MAX_LOOK_BYTES) return null
  return `This model is too large to wear: ${bytes.toLocaleString('en-US')} of ${MAX_LOOK_BYTES.toLocaleString('en-US')} bytes.`
}

/** One look tag's payload read as a model, or null: malformed, over MAX_LOOK_BYTES, or refused by the format (DECK-0003 §1.9). */
const parsed = new Map<string, ShardModel | null>()
const PARSED_MAX = 256
function readLookPayload(payload: string): ShardModel | null {
  if (parsed.has(payload)) return parsed.get(payload)!
  let model: ShardModel | null = null
  if (bytesOf(payload) <= MAX_LOOK_BYTES) {
    try { model = fromPayload(JSON.parse(payload), `look:${payload.length}:${payload.slice(-16)}`) } catch { model = null }
  }
  if (parsed.size >= PARSED_MAX) parsed.delete(parsed.keys().next().value as string)
  parsed.set(payload, model)
  return model
}

/** A thing's own looks, read from its tags: each null when it carries no well-formed one. */
export interface LookTags {
  closed: ShardModel | null
  open: ShardModel | null
}

/**
 * The `look` tags of a chest or a door (§3.6), chosen by shape before any
 * payload is read: a tag is well-formed when its second element is a
 * string and it has exactly two elements (a closed look) or `open` as its
 * third (an open look); the first well-formed tag of each counts, and every
 * other `look` tag is ignored, one whose third element is a word not known
 * among them. Only then is each counted payload checked (DECK-0003 §1.9, and
 * MAX_LOOK_BYTES here): one that fails is no look of that kind, never a fall
 * back to a later tag, and never a reason to drop the chest. `author` is the
 * chest's (or door's) verified signer, the only key whose carried objects
 * count (DECK-0003 §1.10, lib/carried.ts keepOwnTable); null, for an
 * unsigned chest, honours no key.
 */
export function lookTagsOf(tags: readonly unknown[] | undefined, author: string | null = null): LookTags {
  const out: LookTags = { closed: null, open: null }
  if (!tags) return out
  let closed: string | null = null
  let open: string | null = null
  for (const t of tags) {
    if (!Array.isArray(t) || t[0] !== LOOK_TAG || typeof t[1] !== 'string') continue
    if (t.length === 2) closed ??= t[1]
    else if (t[2] === 'open') open ??= t[1]
  }
  const read = (payload: string | null): ShardModel | null => {
    const model = payload === null ? null : readLookPayload(payload)
    return model ? keepOwnTable(model, author) : null
  }
  return { closed: read(closed), open: read(open) }
}

/** What lookOf reads: a chest, and its event's tags (and signer, and signature) when known. */
export interface LookSubject {
  type: string
  event?: { tags: readonly unknown[]; pubkey?: string; sig?: string } | null
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

const custom = new WeakMap<readonly unknown[], Look>()

/**
 * The look a chest or a door wears, or null for anything else: its own
 * `look` tags first (§3.6), else the built-in, TREASURE for a chest and DOOR
 * for a door. A custom closed look with no open one has none: an opened
 * DOOR is then not drawn at all, and only an opened chest keeps its closed
 * look (drawnLook). A custom open look with no closed one is drawn over the
 * built-in closed one ("with no closed look, a reader draws whatever it
 * draws for a chest"). Read once per tag list.
 */
export function lookOf(item: LookSubject): Look | null {
  if (item.type !== 'chest') return null
  const tags = item.event?.tags
  const kind: LookKind = isDoor(tags) ? 'door' : 'chest'
  const builtIn = builtInLook(kind === 'door' ? 'door' : 'treasure')
  if (!tags || !tags.some((t) => Array.isArray(t) && t[0] === LOOK_TAG)) return builtIn
  const held = custom.get(tags)
  if (held) return held
  const own = lookTagsOf(tags, lookAuthor(item.event))
  let look: Look
  if (!own.closed && !own.open) look = builtIn
  else if (!own.closed) look = { ...builtIn, name: 'custom', kind, open: own.open, lid: undefined }
  else {
    look = { name: 'custom', kind, closed: own.closed, open: own.open }
    if (kind === 'chest' && isTreasureShape(own.closed)) look.lid = treasureLid(own.closed)
  }
  custom.set(tags, look)
  return look
}

/** How a look goes out from the hide bar: its size, its quarter turns and its WALK setting, as a shard's do. */
export interface LookPose {
  unit: number
  turn: Turns
  constrain: Constrain
}

/** A model posed for the wire: turned (lib/turn.ts), at the bar's unit, with the bar's WALK setting. */
export function posedLook(model: ShardModel, pose: LookPose): ShardModel {
  return withConstrain({ ...turnShard(model, pose.turn), unit: pose.unit }, pose.constrain)
}

/**
 * A look as tags (§3.6): the closed look, and the open one when there is
 * one, each the payload a kind 3330 would carry. Throws with lookRefusal's
 * words when either is over MAX_LOOK_BYTES, so the hide bar and the seal
 * refuse the same way.
 */
export function lookTags(closed: ShardModel, open: ShardModel | null): string[][] {
  const out: string[][] = []
  for (const [model, extra] of [[closed, []], [open, ['open']]] as const) {
    if (!model) continue
    const payload = JSON.stringify(toPayload(model))
    const refusal = lookRefusal(bytesOf(payload))
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
 * A built-in look as it goes out: closed and open, both posed alike, so the
 * open look stands exactly where the closed one stood. The built-in's own
 * open look keeps its own WALK setting (the slabs' open looks have none, so
 * an opened door does not block), turned and scaled with the closed one.
 */
export function builtInLookTags(name: LookName, pose: LookPose): string[][] {
  const look = builtInLook(name)
  const open = look.open ? { ...turnShard(look.open, pose.turn), unit: pose.unit } : null
  return lookTags(posedLook(look.closed, pose), open)
}

/** A point, as a world item's place is. */
interface At { x: bigint; y: bigint; z: bigint }

/**
 * Whether a thing that came out of an opened chest stays in the chest: it
 * is listed under the chest's rows and floats out as loot, and is not drawn
 * again in the world on top of the chest. That is anything out of a chest
 * (not a door) that stands at the chest's own place. One aimed at its own
 * point (a room built in a chest's region, lib/chests.ts revealedIn) is
 * drawn where it stands, as before, until CONVERT TO DOOR moves such rooms
 * behind doors (chest and door design, P4b). Everything behind a door
 * stands in the room. A thing whose chest is not known is drawn, as before.
 */
export function keptInChest(item: { chestId?: string; at: At }, parent: { at: At; tags?: readonly unknown[] } | undefined): boolean {
  if (!item.chestId || !parent || isDoor(parent.tags)) return false
  return item.at.x === parent.at.x && item.at.y === parent.at.y && item.at.z === parent.at.z
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
