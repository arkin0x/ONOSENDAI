/**
 * smash.ts - what a smash does, after the hold completes (design page 3 and
 * 4.2; the owner's rulings of 2026-11-26 and 2026-11-27).
 *
 * In order:
 *
 * 1. Gather (lib/blueprint/arrangement.ts): every block connected to the one
 *    hit, placed or natural ground, within the 16 by 16 by 16 box.
 * 2. Clear them all, as edits in your own layer (store/useTerrain.ts clear):
 *    the blocks are spent whether or not they compile. Nothing is said
 *    about prizes before the smash (the Compiler tells you nothing); while
 *    you aim, only what would go, and whether it is a construction, pulses
 *    (smashPreview.ts, by smashGroup itself).
 * 3. The shatter starts (store/useSmashFx.ts, scene/SmashFx.tsx).
 * 4. (Later: a drop step. An upgraded Compiler could let some of the smashed
 *    blocks fall as small blocks to pick up. `dropStep` below is where it
 *    goes; today it drops nothing.)
 * 5. If the group stood alone, its key is made during the shatter (PBKDF2 in
 *    a worker, lib/blueprint/keyClient.ts), then its lookup is checked
 *    (DECK-0010 §4.5, §6): the starter recipes, the blueprints you hold,
 *    every record this device has seen, and the relay once blueprint records
 *    are accepted there. Every record with that lookup is a prize, so one
 *    random structure can yield shards you never expected, and several
 *    makers' blueprints of the same shape all pay out (owner, 2026-11-27).
 *    Per maker only the newest record counts; muted makers never; yours
 *    first, then people you follow, then everyone else, newest first. The
 *    Compiler's own lookup yields the Compiler alone, so nobody can attach a
 *    stranger's prize to every newcomer's first smash (§6.1). The other game
 *    recipe, the Quarry Charge's (§8.5), likewise yields seven Quarry
 *    Charges alone, and only with the Compiler in hand.
 * 6. Prizes appear as toys where the build stood (store/useBlueprints.ts
 *    toys, scene/PrizeToys.tsx); no match leaves grey dust and one line.
 *
 * A bare hand (anything but the Compiler in hand) smashes the same way with a
 * longer hold and a smaller reach (a build of 3 by 3 by 3 at most), and
 * only the Compiler's own recipe compiles for it.
 */

import { gather, smashCells, type Cell } from './arrangement'
import { BLUEPRINT_RECORD_KIND, BLUEPRINT_RELAY_READY, WINDOW_ABOVE, WINDOW_BELOW, isPrize, openPrize, readRecord, type Arrangement, type Prize, type RecordEvent } from './format'
import { keyOf } from './keyClient'
import { COMPILER_RECIPE, QUARRY_CHARGE_COUNT, QUARRY_CHARGE_RECIPE, sameArrangement } from './recipes'
import { QUARRY_LOOKUP, QUARRY_NAME } from './gameCard'
import type { NostrEvent } from '../events'

/*
 * ---- The smash's feel. The owner tunes these to taste (2026-11-27). ----
 * The hold, in milliseconds, before the swing, with the Compiler and with a
 * bare hand; the hold bar and the swing's animation stretch to fit it. And
 * how many cells a smash reaches on each axis: the Compiler 16 (DECK-0010 §4),
 * a bare hand 3. A build at most that on every axis compiles wherever it is
 * struck (lib/blueprint/arrangement.ts gather).
 */
export const COMPILER_HOLD_MS = 4000
export const BARE_HOLD_MS = 7000
export const COMPILER_REACH = WINDOW_BELOW + WINDOW_ABOVE + 1
export const BARE_REACH = 3
/* ---- end of the owner's tuning ---- */
/** From the end of the hold to the impact: the swing. */
export const SWING_MS = 180
/** From the impact until the outcome may show (the shatter's main burst). */
export const RESOLVE_AFTER_MS = 1200
/** The most toys drawn in the ring; the rest wait in the picker (owner, 2026-11-27). */
export const RING_MAX = 8
/** The most prizes unsealed from one lookup (the spec's 4, raised at the owner's word; the ring shows RING_MAX). */
export const PRIZES_MAX = 32
/** The line a smash leaves when nothing was compiled: not a construction, or one a bare hand cannot compile (design page 3). */
export const MISS_LINE = 'Nothing compiled. The blocks are spent.'
/** The line when a construction was compiled but no blueprint matches it (the preview said COMPILES: smashPreview.ts). */
export const NO_MATCH_LINE = 'Compiled. No blueprint matches. The blocks are spent.'

/** What a smash says when no relay answered and nothing on this device matched. */
export const OFFLINE_LINE = 'No relay answered, so only blueprints on this device were checked. No blueprint matches. The blocks are spent.'

/**
 * The line a smash that found no prize leaves: a construction was compiled (the preview said COMPILES), so it says no
 * blueprint matches, and why only this device was asked when no relay answered; anything else compiled nothing.
 */
export function missLine(compiled: boolean, offline: boolean, unknown: boolean): string {
  if (!compiled) return MISS_LINE
  return offline ? OFFLINE_LINE : unknown ? UNKNOWN_LINE : NO_MATCH_LINE
}

/** When it compiled into a prize this version cannot open. */
export const UNKNOWN_LINE = 'It compiled into something this version cannot open yet.'

/** Whether a smash compiles what it gathered: a construction, and with a bare hand only the Compiler's recipe (compile below). */
export function compiles(a: Arrangement | null, bare: boolean): boolean {
  return !!a && (!bare || sameArrangement(a, COMPILER_RECIPE))
}

/** One prize found: what it is, and whose blueprint gave it. */
export interface Found {
  prize: Prize
  name: string
  /** The maker's pubkey, or 'game' for a starter recipe. */
  maker: string
  lookup: string
  record: RecordEvent | null
}

/** What the smash needs from the app, so tests can stand in for it. */
export interface SmashDeps {
  /** Records with this lookup this device knows (held cards and seen records). */
  known: (lookup: string) => Promise<RecordEvent[]>
  /** Records with this lookup on the relay; null when it cannot be asked. */
  relay: (lookup: string) => Promise<RecordEvent[] | null>
  remember: (records: RecordEvent[]) => void
  me: () => string
  follows: () => ReadonlySet<string>
  muted: () => ReadonlySet<string>
  /** Heights named by location-locked blueprints you hold (DECK-0010 §3.5): each costs one more key. */
  lockHeights: () => number[]
  /** The key of the region of height `h` holding the whole box, or null when the box crosses a border at that height. */
  regionKey: (h: number) => Uint8Array | null
}

let compilerLookup: Promise<string> | null = null
/** The Compiler recipe's lookup, made once (the same key and lookup as any blueprint). */
export function compilerRecipeLookup(): Promise<string> {
  compilerLookup ??= keyOf(COMPILER_RECIPE).then((k) => k.lookup)
  return compilerLookup
}

/** For tests: forget the cached recipe lookup. */
export function resetRecipeCache(): void {
  compilerLookup = null
}

/** A maker's rank for this reader (DECK-0010 §6.2): yours, then people you follow, then everyone else. */
export function makerRank(maker: string, deps: Pick<SmashDeps, 'me' | 'follows'>): number {
  return maker === deps.me() ? 1 : deps.follows().has(maker) ? 2 : 3
}

/** Records of one lookup in unsealing order (§6.1, §6.2): valid, the newest per maker, muted makers out, then ranked. */
export function rankRecords(records: readonly RecordEvent[], lookup: string, deps: Pick<SmashDeps, 'me' | 'follows' | 'muted'>): RecordEvent[] {
  const newest = new Map<string, RecordEvent>()
  for (const r of records) {
    const v = readRecord(r)
    if (!v || v.lookup !== lookup) continue
    const o = newest.get(r.pubkey)
    if (!o || r.created_at > o.created_at || (r.created_at === o.created_at && r.id < o.id)) newest.set(r.pubkey, r)
  }
  const muted = deps.muted()
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
  return [...newest.values()].filter((r) => !muted.has(r.pubkey))
    .sort((a, b) => makerRank(a.pubkey, deps) - makerRank(b.pubkey, deps) || b.created_at - a.created_at || cmp(a.pubkey, b.pubkey) || cmp(a.id, b.id))
}

/** The prizes behind the records of one lookup, opened with the key, in order; a record whose prize does not open is passed over. */
export async function prizesOf(records: readonly RecordEvent[], lookup: string, key: Uint8Array, deps: Pick<SmashDeps, 'me' | 'follows' | 'muted'>, max = PRIZES_MAX, unknown = { count: 0 }, more = { left: false }): Promise<Found[]> {
  const out: Found[] = []
  for (const r of rankRecords(records, lookup, deps)) {
    // Past the cap, the rest are not opened, and the smash says more may be waiting.
    if (out.length >= max) { more.left = true; break }
    const v = readRecord(r)!
    const prize = await openPrize(key, v.sealed)
    // A tool comes only from a game recipe (§5.5, §8.4): a record's tool prize is passed over.
    if (!isPrize(prize) || prize.type === 'tool') {
      // A prize this version cannot open is counted and said in plain words; its record stays on the device (§5.5).
      if (prize && typeof prize === 'object' && !isPrize(prize)) unknown.count++
      continue
    }
    out.push({ prize, name: v.title, maker: r.pubkey, lookup, record: r })
  }
  return out
}

/** Every prize for an arrangement: a bare hand only ever compiles the Compiler's recipe. */
/** The most location-lock heights one smash tries (each costs a region key and a key); more held are said as "more may be waiting". */
export const LOCK_HEIGHTS_TRIED = 4

export async function compile(a: Arrangement, bare: boolean, deps: SmashDeps): Promise<{ lookup: string; found: Found[]; offline: boolean; unknown: number; more: boolean }> {
  // The Compiler's own recipe yields the Compiler, and only it (§6.1): known by its blocks, so its key is never made twice.
  if (sameArrangement(a, COMPILER_RECIPE)) return { lookup: await compilerRecipeLookup(), found: [{ prize: { type: 'tool', tool: 'compiler' }, name: 'The Compiler', maker: 'game', lookup: await compilerRecipeLookup(), record: null }], offline: false, unknown: 0, more: false }
  if (bare) return { lookup: '', found: [], offline: false, unknown: 0, more: false }
  // The Quarry Charge's recipe (§8.5) yields seven Quarry Charges from the client's own copy, and records under its lookup are never read (§6.1).
  if (sameArrangement(a, QUARRY_CHARGE_RECIPE)) return { lookup: QUARRY_LOOKUP, found: [{ prize: { type: 'tool', tool: 'quarry-charge', count: QUARRY_CHARGE_COUNT }, name: QUARRY_NAME, maker: 'game', lookup: QUARRY_LOOKUP, record: null }], offline: false, unknown: 0, more: false }
  const { key, lookup } = await keyOf(a)
  const unknown = { count: 0 }
  const more = { left: false }
  const keys: Array<{ key: Uint8Array; lookup: string }> = [{ key, lookup }]
  // A location lock adds a region's key: the same arrangement built inside it has a second lookup, one per height tried (§3.5).
  const heights = [...new Set(deps.lockHeights())]
  if (heights.length > LOCK_HEIGHTS_TRIED) more.left = true
  for (const h of heights.slice(0, LOCK_HEIGHTS_TRIED)) {
    const region = deps.regionKey(h)
    if (region) keys.push(await keyOf(a, region))
  }
  const found: Found[] = []
  let offline = false
  for (const k of keys) {
    const [known, relay] = await Promise.all([deps.known(k.lookup), deps.relay(k.lookup).catch(() => undefined)])
    if (relay === undefined) offline = true
    if (relay?.length) deps.remember(relay)
    found.push(...await prizesOf([...known, ...(relay ?? [])], k.lookup, k.key, deps, PRIZES_MAX, unknown, more))
  }
  return { lookup, found, offline, unknown: unknown.count, more: more.left }
}

/** Ask the relay for records with a lookup, through `query`, only once records are accepted there (null: not asked). */
export function relayAsker(query: (filter: { kinds: number[]; '#d': string[]; limit: number }) => Promise<NostrEvent[]>, live: () => boolean): (lookup: string) => Promise<NostrEvent[] | null> {
  return async (lookup) => {
    if (!BLUEPRINT_RELAY_READY || !live()) return null
    return query({ kinds: [BLUEPRINT_RECORD_KIND], '#d': [lookup], limit: 50 })
  }
}

/**
 * One smash, from the blocks as drawn (`read`, cs offsets) at the hit: the gather (DECK-0010 §4: the group, whether it
 * is isolated, and the arrangement a lookup is made from) and, apart from it, what is deleted (`smash`, with `blocks`
 * its ids): the construction whole, or else only the connected blocks in the reach's box round the hit
 * (arrangement.ts smashCells). A bare hand reaches BARE_REACH.
 */
export function smashGroup(read: (x: number, y: number, z: number) => number, hit: Cell, bare = false): ReturnType<typeof gather> & { smash: Array<[number, number, number]>; blocks: Array<{ at: [number, number, number]; id: number }> } {
  const n = bare ? BARE_REACH : COMPILER_REACH
  const g = gather(read, hit, n)
  const smash = smashCells(read, hit, n, g)
  return { ...g, smash, blocks: smash.map((at) => ({ at, id: read(at[0], at[1], at[2]) })) }
}

/**
 * The drop step (a later Compiler upgrade): which smashed blocks fall as
 * small blocks to pick up. None today.
 */
export function dropStep(_blocks: ReadonlyArray<{ at: readonly [number, number, number]; id: number }>): Array<{ at: readonly [number, number, number]; id: number }> {
  return []
}
