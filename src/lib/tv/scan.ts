/**
 * scan.ts: Cyberspace TV opens bags as a spectator does (arkinox,
 * 2026-10-19: "spectating an avatar reveals the shards near them. TV could
 * have the same effect. If you want to hide something, you need to use a
 * depth higher than 12 or take your chain LOCAL or only place objects far
 * away from your chain location. Hiding things deeper than 12 is a valid
 * anti-TV strategy.").
 *
 * At every place an avatar stands on screen, TV derives the region keys a
 * player standing there would (heights 0 to SCAN_MAX_HEIGHT, never further),
 * asks the relays for the bags under them, and opens what it can. The work
 * is done ahead: TV knows its next shots, so their places are scanned before
 * they play, each region once, one relay question per new set of regions.
 * Nothing is shown when it is opened: `at` says what is in the bags at a
 * place AS OF a moment on tape, and only that is shown (store/useTv.ts).
 *
 * As of tape time: a bag counts only once its event was signed. Relays keep
 * only each bag's newest version, so a bag counts from its last change
 * (arkinox's ruling, 2026-10-19): a bag edited after the moment on screen is
 * not there yet, though an older version of it may have been.
 *
 * Only shards, keys and chests (arkinox, 2026-10-19: draw only those, NEVER
 * a message or a coin). A bag's other items are opened with it, since one
 * key opens the whole bag, and never leave this file.
 */

import type { NostrEvent } from '../events'
import { keepsOver, lookupOf } from '../foundCache'
import type { Hidden } from '../hidden'
import type { Position } from '../space'
import type { RegionKeyOut } from '../../workers/region.worker'

/** The kinds of item TV draws and adds to your finds. */
export const TV_ITEM_TYPES: ReadonlyArray<Hidden['type']> = ['shard', 'key', 'chest']

/** Whether TV shows this item: a shard, a key or a chest, never a message (a coin is a message). */
export function tvShows(h: Pick<Hidden, 'type'>): boolean {
  return TV_ITEM_TYPES.includes(h.type)
}

/** The heights a scan derives, 0 up to `max`, the most a player scans. */
export function scanHeights(max: number): number[] {
  return Array.from({ length: max + 1 }, (_, h) => h)
}

/** The aligned base of a position at a height: what decides "same region". */
export function baseAt(p: Position, h: number): Position {
  const b = BigInt(h)
  return { x: (p.x >> b) << b, y: (p.y >> b) << b, z: (p.z >> b) << b }
}

/** A region's name in the caches: its height and its base, which are all its key depends on (spec §7.5). */
export function cellOf(p: Position, h: number): string {
  const b = BigInt(h)
  return `${h}:${p.x >> b},${p.y >> b},${p.z >> b}`
}

/** Each bag once, at its newest: two relays can hold two versions of one address. */
export function newestPerAddress(events: NostrEvent[]): NostrEvent[] {
  const best = new Map<string, NostrEvent>()
  for (const ev of events) {
    const at = `${ev.pubkey}:${lookupOf(ev) ?? ''}`
    const held = best.get(at)
    if (!held || keepsOver(ev, held)) best.set(at, ev)
  }
  return [...best.values()]
}

/** Whether a bag counts at a moment on tape: signed no later than it. */
export function bagAsOf(bag: Pick<NostrEvent, 'created_at'>, tapeTime: number): boolean {
  return bag.created_at <= tapeTime
}

/** A region key a scan derived, and where its region is. */
export interface ScanKey {
  lookupId: string
  keyHex: string
  height: number
  base: Position
  /** The plane of the place it was derived at, for a reference without its own point (unbag's origin). */
  plane: number
}

/** A place an avatar stands on tape. */
export interface ScanPlace { position: Position; plane: number }

/** A bag TV opened: under which key, and what of it TV shows. */
export interface OpenedBag {
  key: ScanKey
  bag: NostrEvent
  /** What TV shows of it (tvShows), never empty. */
  items: Hidden[]
  /** Whether that is the whole bag: only then may it be kept as a find across a reload (store/useTv.ts). */
  whole: boolean
  /** The events its references resolved to, for keeping it (lib/foundCache rememberBag). */
  refs: Record<string, NostrEvent>
}

export interface ScanDeps {
  /** The heights to derive at every place: 0 to SCAN_MAX_HEIGHT. */
  heights: number[]
  /** The keys at one place for these heights, off the frame (lib/regionKeyOffThread regionKeyWorker). */
  derive: (at: Position, heights: number[]) => Promise<RegionKeyOut[]>
  /** The bags under these lookup ids, from the relays. */
  query: (ids: string[]) => Promise<NostrEvent[]>
  /** Open a bag with a key: every item in it, and what its references resolved to. */
  open: (bag: NostrEvent, key: ScanKey) => Promise<{ items: Hidden[]; refs: Record<string, NostrEvent> }>
  /** The most lookup ids in one relay question. */
  batch: number
}

/**
 * The scan's memory for one run of TV: every region it has derived, every
 * lookup id it has asked about, and every bag that opened to something TV
 * shows. A region is derived once and asked about once, whatever plays.
 */
export class TvScanner {
  private readonly cells = new Map<string, ScanKey>()
  /** Regions being derived or derived. */
  private readonly deriving = new Set<string>()
  /** Lookup ids asked about, or being asked. */
  private readonly asked = new Set<string>()
  private readonly bags = new Map<string, OpenedBag[]>()
  /** How many questions have come back with something to show: a change in it is something new to look at. */
  version = 0
  /** How many relay questions it has asked, for tests. */
  questions = 0

  constructor(private readonly deps: ScanDeps) {}

  /**
   * Derive the keys at these places, then ask once about every region not
   * asked about before, and open what comes back. Resolves when it is done;
   * nothing it finds is shown from here.
   */
  async prepare(places: ScanPlace[]): Promise<void> {
    const { heights } = this.deps
    const jobs: Promise<void>[] = []
    for (const { position: p, plane } of places) {
      const missing = heights.filter((h) => !this.deriving.has(cellOf(p, h)))
      if (missing.length === 0) continue
      for (const h of missing) this.deriving.add(cellOf(p, h))
      jobs.push(this.deps.derive(p, missing).then((keys) => {
        for (const k of keys) this.cells.set(cellOf(p, k.height), { lookupId: k.lookupId, keyHex: k.keyHex, height: k.height, base: baseAt(p, k.height), plane })
      }, () => {
        // Asked again the next time a shot stands there.
        for (const h of missing) this.deriving.delete(cellOf(p, h))
      }))
    }
    await Promise.all(jobs)
    const fresh = new Map<string, ScanKey>()
    for (const { position: p } of places) {
      for (const h of heights) {
        const key = this.cells.get(cellOf(p, h))
        if (key && !this.asked.has(key.lookupId)) fresh.set(key.lookupId, key)
      }
    }
    const ids = [...fresh.keys()]
    for (const id of ids) this.asked.add(id)
    for (let i = 0; i < ids.length; i += this.deps.batch) {
      const chunk = ids.slice(i, i + this.deps.batch)
      let events: NostrEvent[]
      this.questions++
      try { events = await this.deps.query(chunk) } catch {
        for (const id of chunk) this.asked.delete(id)
        continue
      }
      let opened = false
      for (const bag of newestPerAddress(events)) {
        const id = lookupOf(bag)
        const key = id ? fresh.get(id) : undefined
        if (!key) continue
        let all: Hidden[]
        let refs: Record<string, NostrEvent>
        try { ({ items: all, refs } = await this.deps.open(bag, key)) } catch { continue }
        const items = all.filter(tvShows)
        if (items.length === 0) continue
        this.bags.set(key.lookupId, [...(this.bags.get(key.lookupId) ?? []), { key, bag, items, whole: items.length === all.length, refs }])
        opened = true
      }
      if (opened) this.version++
    }
  }

  /** The bags TV can show at a place at a moment on tape: in a region scanned there, and signed by then. */
  at(p: Position, tapeTime: number): OpenedBag[] {
    const out: OpenedBag[] = []
    for (const h of this.deps.heights) {
      const key = this.cells.get(cellOf(p, h))
      if (!key) continue
      for (const o of this.bags.get(key.lookupId) ?? []) if (bagAsOf(o.bag, tapeTime)) out.push(o)
    }
    return out
  }
}

/**
 * Whether something drawn stands in front of the shot's subject, close
 * enough to the line of sight to cover any of it: then it fades, so the
 * avatar stays readable (arkinox, 2026-10-19: "fade it"). Both are spheres,
 * in the render frame: the camera at `eye`, the subject at `subject` with
 * radius `subjectR`, the thing at `at` with radius `r`. One the subject
 * stands inside counts too.
 */
export function coversSubject(eye: readonly number[], subject: readonly number[], subjectR: number, at: readonly number[], r: number): boolean {
  const d = [subject[0] - eye[0], subject[1] - eye[1], subject[2] - eye[2]]
  const ds = Math.hypot(d[0], d[1], d[2])
  if (!(ds > 0)) return false
  const dir = [d[0] / ds, d[1] / ds, d[2] / ds]
  const v = [at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]]
  // How far along the line of sight it is, and how far off it.
  const t = v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]
  if (t + r <= 0 || t - r >= ds) return false
  const off = Math.hypot(v[0] - t * dir[0], v[1] - t * dir[1], v[2] - t * dir[2])
  // The subject's outline, as wide at that depth as it looks from the camera.
  return off < r + subjectR * Math.max(0, t) / ds
}
