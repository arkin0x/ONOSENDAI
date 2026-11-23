/**
 * shardGroups.ts - named groups of a shard's points, faces and placed objects,
 * for the workshop's SELECT tool (owner, 2026-11-23: "take pieces in my
 * workshop imported kits and build whole levels as a single shard").
 *
 * A group is the author's handle on a piece of a big shard: a kit piece
 * pasted in, a wall, a tree. It is held by index into the shard's own lists,
 * the same indices the selection uses, so selecting a group is the selection
 * the author would have gathered by hand.
 *
 * Editor data only. Groups live on the workshop's local copy of the shard
 * (`groups`, beside `paletteName`, another local field), so they ride along
 * with UNDO, REDO, a reload and DUPLICATE, and they are never on the wire:
 * sno-core's toPayload writes only the fields DECK-0003 defines, so a group
 * never reaches a payload, a fingerprint or a relay. Publishing, COPY AS TEXT
 * and the Shard Feed see the shard exactly as they did before groups.
 *
 * Indices move when geometry does: a delete renumbers what is after it, a
 * WELD folds stacked points into one, SUBDIVIDE cuts a face into four, a
 * stamp drops the faces it buries. `remapGroups` carries every group across
 * any edit (the store runs it on every edit, useWorkshop `edit`), from the
 * shard before and after alone, with an explicit hint where the two cannot
 * say it (which placed objects a delete took). A group the edit emptied goes;
 * UNDO brings it back with the geometry, because both are in the snapshot.
 */

import { pointKey, ticksOf, uuid, type Part, type ShardModel } from 'sno-core/shards'

/** A named group of a shard's points, faces and placed objects, by index. */
export interface ShardGroup {
  /** Stable for the group's life; never shown. */
  id: string
  /** What the author calls it. */
  name: string
  /** Vertex indices, sorted, no repeats. */
  vertices: number[]
  /** Face indices, sorted, no repeats. */
  faces: number[]
  /** Placed-object indices (into `parts`), sorted, no repeats. */
  parts: number[]
}

/** A shard as the workshop keeps it: with its groups, when it has any. */
export type GroupedShard = ShardModel & { groups?: ShardGroup[] }

/** What a group or a selection holds, by index. */
export interface Members {
  vertices: readonly number[]
  faces: readonly number[]
  parts: readonly number[]
}

/** The longest group name kept. */
export const GROUP_NAME_MAX = 48

const NONE: ShardGroup[] = []

/** The shard's groups, oldest first; an empty list when it has none. */
export function groupsOf(s: ShardModel | null | undefined): ShardGroup[] {
  const g = (s as GroupedShard | null | undefined)?.groups
  return Array.isArray(g) ? g : NONE
}

/** The shard with these groups: the field removed when there are none, so a shard with no groups is stored as it always was. */
export function withGroups<T extends ShardModel>(s: T, groups: readonly ShardGroup[]): T {
  const { groups: _had, ...bare } = s as T & { groups?: ShardGroup[] }
  void _had
  return (groups.length ? { ...bare, groups: [...groups] } : bare) as T
}

/** Sorted, deduped, whole numbers in 0..length-1 only. */
export function cleanIndices(list: readonly unknown[] | undefined, length: number): number[] {
  if (!Array.isArray(list)) return []
  const out = new Set<number>()
  for (const i of list) if (Number.isInteger(i) && (i as number) >= 0 && (i as number) < length) out.add(i as number)
  return [...out].sort((a, b) => a - b)
}

/** A group's name tidied: trimmed, one line, not too long. Empty when nothing is left. */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, GROUP_NAME_MAX)
}

/** Whether a group holds nothing at all. */
export const isEmpty = (g: Members): boolean => g.vertices.length === 0 && g.faces.length === 0 && g.parts.length === 0

/**
 * The groups of a stored shard, read back as the store trusts them: each with
 * an id, a name and in-range indices; anything malformed is dropped, a group
 * left empty with it. Run on every shard read from storage (workshopStorage
 * normalizeOne), so an older build or a hand-edited record never hands the
 * bench an index it does not have.
 */
export function saneGroups<T extends ShardModel>(s: T): T {
  const raw = (s as T & { groups?: unknown }).groups
  if (raw === undefined) return s
  if (!Array.isArray(raw)) return withGroups(s, [])
  const seen = new Set<string>()
  const out: ShardGroup[] = []
  for (const g of raw as Array<Partial<ShardGroup> | null>) {
    if (!g || typeof g !== 'object' || typeof g.id !== 'string' || !g.id || seen.has(g.id)) continue
    const group: ShardGroup = {
      id: g.id,
      name: cleanName(typeof g.name === 'string' ? g.name : '') || 'Group',
      vertices: cleanIndices(g.vertices, s.vertices.length),
      faces: cleanIndices(g.faces, s.faces.length),
      parts: cleanIndices(g.parts, s.parts?.length ?? 0),
    }
    if (isEmpty(group)) continue
    seen.add(g.id)
    out.push(group)
  }
  return withGroups(s, out)
}

/** "Group 3": the first such name no group has yet, counting from `from`. */
export function nextName(groups: readonly ShardGroup[], base = 'Group', from = 1): string {
  const taken = new Set(groups.map((g) => g.name.toLowerCase()))
  const root = cleanName(base) || 'Group'
  for (let n = from; ; n++) {
    const name = cleanName(`${root.slice(0, GROUP_NAME_MAX - String(n).length - 1)} ${n}`)
    if (!taken.has(name.toLowerCase())) return name
  }
}

/**
 * A name for a group that copies `name`: "Rock" makes "Rock 2", "Rock 2"
 * makes "Rock 3", always the first number no group has.
 */
export function copyName(groups: readonly ShardGroup[], name: string): string {
  const m = /^(.*?) (\d+)$/.exec(name)
  return m ? nextName(groups, m[1], Number(m[2]) + 1) : nextName(groups, name, 2)
}

/** A name nobody has used yet in this shard: `name` itself when it is free, else the next numbered one. */
export function freeName(groups: readonly ShardGroup[], name: string): string {
  const n = cleanName(name) || 'Group'
  return groups.some((g) => g.name.toLowerCase() === n.toLowerCase()) ? copyName(groups, n) : n
}

/** A new group of these members (cleaned against `s`), under `name`. Null when it would hold nothing. */
export function makeGroup(s: ShardModel, name: string, m: Members): ShardGroup | null {
  const g: ShardGroup = {
    id: uuid(),
    name: cleanName(name) || 'Group',
    vertices: cleanIndices(m.vertices as number[], s.vertices.length),
    faces: cleanIndices(m.faces as number[], s.faces.length),
    parts: cleanIndices(m.parts as number[], s.parts?.length ?? 0),
  }
  return isEmpty(g) ? null : g
}

/**
 * `after` with one more group, holding everything `after` added past
 * `before`: the vertices, faces and placed objects appended. PASTE's group,
 * IMPORT's, and a stamped COPY's (one call from the stamp: the shard before,
 * the shard after, the name). The name is made free first ("Rock 2" when a
 * "Rock" is there). Returns `after` unchanged when nothing was added.
 */
export function withAppendedGroup<T extends ShardModel>(before: ShardModel, after: T, name: string): T {
  const range = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k)
  const groups = groupsOf(after)
  const g = makeGroup(after, freeName(groups, name), {
    vertices: range(before.vertices.length, after.vertices.length),
    faces: range(before.faces.length, after.faces.length),
    parts: range(before.parts?.length ?? 0, after.parts?.length ?? 0),
  })
  return g ? withGroups(after, [...groups, g]) : after
}

/** The union of a group and some members, cleaned. */
export function addMembers(g: ShardGroup, m: Members): ShardGroup {
  const join = (a: readonly number[], b: readonly number[]): number[] => [...new Set([...a, ...b])].sort((x, y) => x - y)
  return { ...g, vertices: join(g.vertices, m.vertices), faces: join(g.faces, m.faces), parts: join(g.parts, m.parts) }
}

/** A group without some members. */
export function removeMembers(g: ShardGroup, m: Members): ShardGroup {
  const drop = (a: readonly number[], b: readonly number[]): number[] => { const out = new Set(b); return a.filter((i) => !out.has(i)) }
  return { ...g, vertices: drop(g.vertices, m.vertices), faces: drop(g.faces, m.faces), parts: drop(g.parts, m.parts) }
}

/** How many of a group's members are in `m`, each kind counted. */
export function overlap(g: Members, m: Members): number {
  const count = (a: readonly number[], b: readonly number[]): number => { const s = new Set(b); let n = 0; for (const i of a) if (s.has(i)) n++; return n }
  return count(g.vertices, m.vertices) + count(g.faces, m.faces) + count(g.parts, m.parts)
}

/** How many of `m`'s members a group does not hold yet. */
export function missing(g: Members, m: Members): number {
  const count = (a: readonly number[], b: readonly number[]): number => { const s = new Set(a); let n = 0; for (const i of b) if (!s.has(i)) n++; return n }
  return count(g.vertices, m.vertices) + count(g.faces, m.faces) + count(g.parts, m.parts)
}

/**
 * What the group puts in hand when it is selected. Its points and placed
 * objects as they are, never widened to a stack: a paste lands on its
 * original, and a group of the paste must take the copy alone. A group of
 * faces alone (made in SELECT FACES) is held as faces, with their corners,
 * as a tapped face is; a group with points is held as points, its own and
 * the corners of any face it holds, so its faces move with it.
 */
export function heldBy(s: ShardModel, g: ShardGroup): { selection: number[]; partSel: number[]; selectedFaces: number[] } {
  const faces = g.faces.filter((i) => s.faces[i])
  const corners = faces.flatMap((i) => s.faces[i])
  const partSel = cleanIndices(g.parts, s.parts?.length ?? 0)
  if (g.vertices.length === 0 && faces.length > 0) return { selection: cleanIndices(corners, s.vertices.length), partSel, selectedFaces: faces }
  return { selection: cleanIndices([...g.vertices, ...corners], s.vertices.length), partSel, selectedFaces: [] }
}

/** How much of a group is in hand: all of it, some, or none. */
export function heldState(s: ShardModel, g: ShardGroup, held: { selection: readonly number[]; partSel: readonly number[]; selectedFaces: readonly number[] }): 'all' | 'some' | 'none' {
  const want = heldBy(s, g)
  const total = want.selection.length + want.partSel.length + want.selectedFaces.length
  if (total === 0) return 'none'
  const n = overlap({ vertices: want.selection, faces: want.selectedFaces, parts: want.partSel }, { vertices: held.selection, faces: held.selectedFaces, parts: held.partSel })
  return n === 0 ? 'none' : n === total ? 'all' : 'some'
}

/**
 * What is in hand, as a group would hold it. Faces held (SELECT FACES) are
 * held as faces, not as their corners, so a group made of faces is a group of
 * faces; otherwise the points; placed objects either way.
 */
export function membersHeld(held: { selection: readonly number[]; partSel: readonly number[]; selectedFaces: readonly number[] }): Members {
  return held.selectedFaces.length > 0
    ? { vertices: [], faces: held.selectedFaces, parts: held.partSel }
    : { vertices: held.selection, faces: [], parts: held.partSel }
}

/** A group's counts as the panel shows them: points (stacked vertices count once, as the held bar counts), faces, objects. */
export function groupCounts(s: ShardModel, g: ShardGroup): { points: number; faces: number; objects: number } {
  const spots = new Set<string>()
  for (const i of g.vertices) { const v = s.vertices[i]; if (v) spots.add(pointKey(ticksOf(v))) }
  return { points: spots.size, faces: g.faces.filter((i) => s.faces[i]).length, objects: g.parts.filter((i) => s.parts?.[i]).length }
}

/** Hints an edit gives the remap where the shard before and after cannot say it exactly. */
export interface RemapHint {
  /** Where each vertex went, by its index before (WELD: a folded one goes where it was folded); -1 or absent for gone. */
  vertexTo?: readonly number[]
  /** Which face before each face after was (a child of SUBDIVIDE, its parent), or -1 for a face the edit made. */
  faceFrom?: readonly number[]
  /** Where each face went, by its index before (WELD: two faces made twins go to the one kept); -1 for gone. */
  faceTo?: readonly number[]
  /** SUBDIVIDE's midpoints, each with the ends (indices before) of the edge it halves: a group holding both ends holds it. */
  midpoints?: ReadonlyArray<{ at: number; ends: readonly [number, number] }>
  /** The placed objects an edit removed, by their index before it (DELETE, CUT). */
  partsGone?: ReadonlySet<number>
}

/** Where each old index went: a list of new indices (several for a face cut in four), empty when it is gone. */
type IndexMap = (i: number) => number[]

const same = (i: number): number[] => [i]

/**
 * Where each vertex of `before` is in `after`.
 *
 * Told by the edit (WELD), that. Otherwise: every edit that keeps the count
 * keeps the order (a move, a turn, a color), and every edit that adds
 * appends (PASTE, a stamp, SUBDIVIDE's midpoints), so those keep every index.
 * An edit that removes (DELETE, CUT) keeps the vertices it leaves as the same
 * objects, in order, so they are found by identity.
 */
function vertexMap(before: ShardModel, after: ShardModel, hint: RemapHint): IndexMap {
  const told = hint.vertexTo
  if (told) return (i) => { const j = told[i]; return j === undefined || j < 0 ? [] : [j] }
  if (after.vertices === before.vertices || after.vertices.length >= before.vertices.length) return same
  const at = new Map<unknown, number>()
  after.vertices.forEach((v, i) => { if (!at.has(v)) at.set(v, i) })
  return (i) => { const j = at.get(before.vertices[i]); return j === undefined ? [] : [j] }
}

/** A part's place and look, without its ref index (which a removal renumbers), for matching one across an edit. */
function partKey(s: ShardModel, p: Part): string {
  const r = s.refs?.[p.ref]
  return JSON.stringify([r ?? p.ref, p.at, p.turn, p.step])
}

/**
 * Where each placed object of `before` is in `after`. Kept count or appended:
 * every index stays. Removed: by the edit's own list when it gave one, else
 * by identity, then by matching in order (sno-core removeParts keeps the
 * order of what it leaves and changes only each one's ref index).
 */
function partMap(before: ShardModel, after: ShardModel, hint: RemapHint): IndexMap {
  const was = before.parts ?? []
  const now = after.parts ?? []
  if (now === was || now.length >= was.length) return same
  const gone = hint.partsGone
  if (gone) {
    const to: number[] = []
    let k = 0
    for (let i = 0; i < was.length; i++) to.push(gone.has(i) ? -1 : k++)
    if (k === now.length) return (i) => (to[i] >= 0 ? [to[i]] : [])
  }
  const to = new Array<number>(was.length).fill(-1)
  const byObject = new Map<unknown, number>()
  now.forEach((p, i) => byObject.set(p, i))
  let found = 0
  was.forEach((p, i) => { const j = byObject.get(p); if (j !== undefined) { to[i] = j; found++ } })
  if (found < now.length) {
    const used = new Set(to.filter((j) => j >= 0))
    let j = 0
    for (let i = 0; i < was.length; i++) {
      if (to[i] >= 0) continue
      while (j < now.length && used.has(j)) j++
      if (j < now.length && partKey(before, was[i]) === partKey(after, now[j])) { to[i] = j; used.add(j); j++ }
    }
  }
  return (i) => (to[i] >= 0 ? [to[i]] : [])
}

/**
 * Where each face of `before` is in `after`, once the vertices are known.
 *
 * Told by the edit (which old face each new one was: a delete, a stamp that
 * buries faces, SUBDIVIDE's children, WELD), that. Otherwise a face kept as
 * the same array is itself (a filter, an append), and the rest are found by
 * their three corners, renumbered and order-free (a flip turns them round). A
 * face whose corner went, or that is found nowhere, is gone.
 */
function faceMap(before: ShardModel, after: ShardModel, vmap: IndexMap, hint: RemapHint): IndexMap {
  const sent = hint.faceTo
  if (sent) return (i) => { const j = sent[i]; return j === undefined || j < 0 ? [] : [j] }
  const told = hint.faceFrom
  if (told) {
    const to = new Map<number, number[]>()
    told.forEach((i, j) => { if (i >= 0) { const l = to.get(i); if (l) l.push(j); else to.set(i, [j]) } })
    return (i) => to.get(i) ?? []
  }
  if (after.faces === before.faces) return same
  // Every old face still where it was (only appends since): no pass needed.
  if (after.faces.length >= before.faces.length && before.faces.every((f, i) => after.faces[i] === f)) return same
  const result = new Array<number>(before.faces.length).fill(-1)
  const matched = new Set<number>()
  // A face left as the same array is itself, found first, so a twin on the same corners never takes its place.
  const byObject = new Map<unknown, number>()
  after.faces.forEach((f, j) => { if (!byObject.has(f)) byObject.set(f, j) })
  const rest: number[] = []
  before.faces.forEach((f, i) => {
    const j = byObject.get(f)
    if (j !== undefined && !matched.has(j)) { result[i] = j; matched.add(j) } else rest.push(i)
  })
  if (rest.length) {
    const byKey = new Map<string, number[]>()
    after.faces.forEach((f, j) => { if (matched.has(j)) return; const k = triKey(f); const l = byKey.get(k); if (l) l.push(j); else byKey.set(k, [j]) })
    for (const i of rest) {
      const m: number[] = []
      for (const v of before.faces[i]) { const t = vmap(v); if (t.length === 0) break; m.push(t[0]) }
      if (m.length < 3) continue
      const list = byKey.get(triKey(m))
      const j = list?.find((x) => !matched.has(x))
      if (j === undefined) continue
      matched.add(j)
      result[i] = j
    }
  }
  return (i) => (result[i] >= 0 ? [result[i]] : [])
}

const triKey = (f: readonly number[]): string => [...f].sort((a, b) => a - b).join(',')

/**
 * Every group carried from `before` to `after`, whatever the edit between
 * them did (see the top of this file). A group the edit left empty goes; a
 * group nothing changed is the same object, so UNDO's snapshots share it.
 */
export function remapGroups(before: ShardModel, after: ShardModel, groups: readonly ShardGroup[], hint: RemapHint = {}): ShardGroup[] {
  if (groups.length === 0) return []
  const vmap = vertexMap(before, after, hint)
  const pmap = partMap(before, after, hint)
  const fmap = faceMap(before, after, vmap, hint)
  const nv = after.vertices.length, nf = after.faces.length, np = after.parts?.length ?? 0
  const out: ShardGroup[] = []
  for (const g of groups) {
    const move = (list: number[], map: IndexMap, n: number): number[] => {
      let changed = false
      const next: number[] = []
      for (const i of list) {
        const to = map(i)
        if (to.length !== 1 || to[0] !== i) changed = true
        for (const j of to) if (j >= 0 && j < n) next.push(j)
      }
      if (!changed && next.length === list.length) return list
      return [...new Set(next)].sort((a, b) => a - b)
    }
    let vertices = move(g.vertices, vmap, nv)
    // A midpoint on an edge whose two ends the group held is the group's too.
    if (hint.midpoints?.length && g.vertices.length) {
      const had = new Set(g.vertices)
      const extra = hint.midpoints.filter((m) => had.has(m.ends[0]) && had.has(m.ends[1]) && m.at < nv).map((m) => m.at)
      if (extra.length) vertices = [...new Set([...vertices, ...extra])].sort((x, y) => x - y)
    }
    const faces = move(g.faces, fmap, nf)
    const parts = move(g.parts, pmap, np)
    if (vertices === g.vertices && faces === g.faces && parts === g.parts) { out.push(g); continue }
    const next = { ...g, vertices, faces, parts }
    if (!isEmpty(next)) out.push(next)
  }
  return out
}

/** What is in hand, as the store keeps it. */
export interface Held {
  selection: readonly number[]
  partSel: readonly number[]
  selectedFaces: readonly number[]
}

/** Everything in hand: the points (a held face's corners among them), the faces, the placed objects. */
export const allHeld = (h: Held): Members => ({ vertices: h.selection, faces: h.selectedFaces, parts: h.partSel })

/** Whether ADD would put anything new in the group. */
export const canAdd = (g: Members, h: Held): boolean => missing(g, membersHeld(h)) > 0

/** Whether REMOVE would take anything out of the group: anything in hand that it holds, a held face's corners included. */
export const canRemove = (g: Members, h: Held): boolean => overlap(g, allHeld(h)) > 0

/** What hidden groups take off the bench: their points, their faces and every face on a hidden point, their placed objects. */
export interface HiddenSets {
  vertices: Set<number>
  faces: Set<number>
  parts: Set<number>
}

/** What `hidden` (groups of `s`) hide. Null when they hide nothing. */
export function hiddenSets(s: ShardModel, hidden: readonly ShardGroup[]): HiddenSets | null {
  if (hidden.length === 0) return null
  const vertices = new Set<number>(), faces = new Set<number>(), parts = new Set<number>()
  for (const g of hidden) { for (const i of g.vertices) vertices.add(i); for (const k of g.faces) faces.add(k); for (const p of g.parts) parts.add(p) }
  if (vertices.size) s.faces.forEach((f, k) => { if (f.some((i) => vertices.has(i))) faces.add(k) })
  // A corner only hidden faces stand on goes too, so nothing left in sight can bend a hidden face.
  if (faces.size) {
    const shown = new Set<number>()
    s.faces.forEach((f, k) => { if (!faces.has(k)) for (const i of f) shown.add(i) })
    for (const k of faces) for (const i of s.faces[k] ?? []) if (!shown.has(i)) vertices.add(i)
  }
  return vertices.size || faces.size || parts.size ? { vertices, faces, parts } : null
}

/** What is in hand, less anything hidden: nothing is held out of sight. The same object when nothing changes. */
export function withoutHidden<T extends Held>(held: T, h: HiddenSets | null): T {
  if (!h) return held
  const selection = held.selection.filter((i) => !h.vertices.has(i))
  const partSel = held.partSel.filter((i) => !h.parts.has(i))
  const selectedFaces = held.selectedFaces.filter((k) => !h.faces.has(k))
  if (selection.length === held.selection.length && partSel.length === held.partSel.length && selectedFaces.length === held.selectedFaces.length) return held
  return { ...held, selection, partSel, selectedFaces }
}

/**
 * The shard as the bench draws it with some groups hidden: their points,
 * faces and placed objects left out, everything else renumbered, and the way
 * back from each drawn face and placed object to the shard's own index, so a
 * tap on what is drawn still means the shard's face. Null when nothing is
 * hidden, and the bench draws the shard itself.
 */
export function hiddenView(s: ShardModel, h: HiddenSets | null): { shard: ShardModel; faceOf: number[]; partOf: number[] } | null {
  if (!h) return null
  const vto = new Map<number, number>()
  const vertices = s.vertices.filter((_, i) => { if (h.vertices.has(i)) return false; vto.set(i, vto.size); return true })
  const faceOf = s.faces.map((_, k) => k).filter((k) => !h.faces.has(k))
  const faces = faceOf.map((k) => s.faces[k].map((i) => vto.get(i) as number) as [number, number, number])
  const partOf = (s.parts ?? []).map((_, i) => i).filter((i) => !h.parts.has(i))
  const seams = s.facecolors && s.facecolors.length === s.faces.length ? s.facecolors : null
  const { facecolors: _fc, parts: _p, ...rest } = s
  void _fc; void _p
  const shard: ShardModel = {
    ...rest,
    vertices,
    faces,
    ...(seams && faces.length ? { facecolors: faceOf.map((k) => seams[k]) } : {}),
    ...(s.parts ? { parts: partOf.map((i) => s.parts![i]) } : {}),
  }
  return { shard, faceOf, partOf }
}

/**
 * What DELETE CONTENTS (useWorkshop deleteGroupAndGeometry) takes, so its
 * confirmation says the real loss: the group's points, every face that goes
 * (its own and every face on one of its points), its placed objects, how many
 * of those faces were not the group's own, and the other groups that lose
 * something too.
 */
export function groupLoss(s: ShardModel, g: ShardGroup): { points: number; faces: number; objects: number; facesBesides: number; others: string[] } {
  const verts = new Set(g.vertices.filter((i) => s.vertices[i]))
  const own = new Set(g.faces.filter((k) => s.faces[k]))
  const faces = new Set(own)
  if (verts.size) s.faces.forEach((f, k) => { if (f.some((i) => verts.has(i))) faces.add(k) })
  const parts = new Set(g.parts.filter((i) => s.parts?.[i]))
  const spots = new Set([...verts].map((i) => pointKey(ticksOf(s.vertices[i]))))
  const others = groupsOf(s).filter((x) => x.id !== g.id && (x.vertices.some((i) => verts.has(i)) || x.faces.some((k) => faces.has(k)) || x.parts.some((i) => parts.has(i)))).map((x) => x.name)
  return { points: spots.size, faces: faces.size, objects: parts.size, facesBesides: faces.size - own.size, others }
}

/** What is in hand as sets, made once per draw of the GROUPS list rather than once per row. */
export interface HeldSets {
  selection: ReadonlySet<number>
  partSel: ReadonlySet<number>
  selectedFaces: ReadonlySet<number>
  /** Whether faces are held (SELECT FACES): what ADD puts in a group is then the faces. */
  faceMode: boolean
}

export function heldSets(h: Held): HeldSets {
  return { selection: new Set(h.selection), partSel: new Set(h.partSel), selectedFaces: new Set(h.selectedFaces), faceMode: h.selectedFaces.length > 0 }
}

/**
 * One row's state, against sets made once: how much of the group is held,
 * whether ADD would add anything, whether REMOVE would take anything out.
 * The same answers as heldState, canAdd and canRemove, at the group's size
 * rather than the selection's.
 */
export function rowState(s: ShardModel, g: ShardGroup, h: HeldSets): { held: 'all' | 'some' | 'none'; addable: boolean; removable: boolean } {
  const want = heldBy(s, g)
  let n = 0
  for (const i of want.selection) if (h.selection.has(i)) n++
  for (const i of want.partSel) if (h.partSel.has(i)) n++
  for (const k of want.selectedFaces) if (h.selectedFaces.has(k)) n++
  const total = want.selection.length + want.partSel.length + want.selectedFaces.length
  const state = total === 0 || n === 0 ? 'none' : n === total ? 'all' : 'some'
  // REMOVE: anything held that the group holds.
  let removable = false
  for (const i of g.vertices) if (h.selection.has(i)) { removable = true; break }
  if (!removable) for (const k of g.faces) if (h.selectedFaces.has(k)) { removable = true; break }
  if (!removable) for (const i of g.parts) if (h.partSel.has(i)) { removable = true; break }
  // ADD: anything held, as a group would hold it, that the group lacks: fewer of
  // the group's members in hand than there are things in hand. Walks the group, not the selection.
  let inHand = 0
  if (h.faceMode) { for (const k of g.faces) if (h.selectedFaces.has(k)) inHand++ } else for (const i of g.vertices) if (h.selection.has(i)) inHand++
  for (const i of g.parts) if (h.partSel.has(i)) inHand++
  const addable = inHand < (h.faceMode ? h.selectedFaces.size : h.selection.size) + h.partSel.size
  return { held: state, addable, removable }
}

const countsCache = new WeakMap<ShardGroup, { v: unknown; f: unknown; p: unknown; counts: ReturnType<typeof groupCounts> }>()

/** groupCounts, kept per group until the group or the shard's lists change: a change of what is held recounts nothing (a move does, its vertices are a new list). */
export function groupCountsCached(s: ShardModel, g: ShardGroup): { points: number; faces: number; objects: number } {
  const hit = countsCache.get(g)
  if (hit && hit.v === s.vertices && hit.f === s.faces && hit.p === s.parts) return hit.counts
  const counts = groupCounts(s, g)
  countsCache.set(g, { v: s.vertices, f: s.faces, p: s.parts, counts })
  return counts
}
