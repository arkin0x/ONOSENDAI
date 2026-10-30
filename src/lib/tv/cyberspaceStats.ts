/**
 * cyberspaceStats.ts: CYBERSPACE STATS, Cyberspace TV's leaderboard break
 * (arkinox, 2026-10-30: "cyberspace tv leaderboards for: longest chain, most
 * bags hidden, and whatever else you can think of"; named CYBERSPACE STATS the
 * same day). Design: onosendai/tv-leaderboards-design.md, phase 1.
 *
 * One board a break, in turn (BOARD_ORDER), cut in like a spot (lib/tv/hosakaAd):
 * the picture steps away, the marquee stays, the music plays on. It shows now,
 * not the tape's time, stamped AS OF the hour it was counted to (rulings D5,
 * design 3.3 L4: a board changes on the hour, so a change on screen never
 * times a move).
 *
 * The boards (ruling D3), each a shared counting rule ranked (lib/countingRules):
 *
 * | Board | Rule |
 * |---|---|
 * | LONGEST CHAIN | chainLength: valid actions on the current chain, the spawn included (the current chain for now: the CHAIN badge's best-of-any-chain is an owner ruling pending) |
 * | MOST BAGS HIDDEN | bagsHidden: live sealed bags, distinct d, at most 5 a UTC day |
 * | MOST RESPAWNS | respawnCount: spawns after the first that kept going |
 * | MOST OBJECTS PUBLISHED | objectsPublished: live public objects, each a new shape, 8+ vertices, at most 10 a UTC day |
 * | NEW ARRIVALS | keys whose first spawn is in the week to AS OF, and the week before |
 * | ACTIVE USERS | keys with a valid action in the week to AS OF, HUMANS and AGENTS apart, and the week before |
 *
 * Everyone with qualifying public activity can be on a board (ruling D4: no
 * opt-out), arkinox included, ranked like anyone, with no row of his own
 * ("I'm not the house... put me in the normal leaderboards and give people
 * something to aspire to"). Agents (a kind 0 with `bot: true` and a `p`
 * marked `operator`, lib/agentInvite) are never ranked among humans (badge
 * plan 6.8); with one agent today they have no board of their own yet, and
 * ACTIVE USERS counts them apart. Whether a key is an agent is read from its
 * kind 0, so a break waits for the profiles of everyone it could show or
 * count (PROFILE_HOLD_MS); a key whose profile is still unknown then is left
 * off the rankings and out of both HUMANS and AGENTS, never guessed a human
 * (review of #537). A viewer's own blocks take a key off the rankings, as
 * they take it off the air.
 *
 * Counts only: no board carries, names or implies a coordinate, sector,
 * height, hint or bag location (design 3.3 L1, L2). A row is a rank, a key
 * and a number.
 *
 * Phase 1 counts in the TV page (ruling D2) from what TV reads: the census
 * (lib/tv/stats loadCensus: spawns, bags, objects and their deletions), plus
 * every v2 movement event, which the chain rules need. Each is read whole
 * once, then only what is new since the last read (READ_OVERLAP_S back, for
 * events signed earlier than they were published), whole again once a day;
 * an hour already counted is not counted again (review of #537). Whether the
 * site's TV counts at all is one flag (STATS_ON_SITE); the stream always does. StatsSnapshot is the seam a site page or the
 * later signed service (design 3.2) fills or reads instead.
 */

import type { NostrEvent } from '../events'
import { ACTION_KIND } from '../events'
import {
  WEEK_S, activeKeys, actionsByAuthor, arrivalsIn, bagsHidden, keyChains, objectsPublished,
  type BagRecord, type Deletion, type ObjectRecord,
} from '../countingRules'
import { EXPLAINER_AD_GAP_MS } from './explainer'
import { V2_EPOCH, askAll, type Ask } from './tape'
import { READ_OVERLAP_S, READ_WHOLE_S } from './stats'
import type { AdTheme } from './hosakaAd'

/** The name on the break's tag and its stamp (arkinox, 2026-10-30). */
export const STATS_TAG = 'CYBERSPACE STATS'

/** How often a break plays, ms of TV on: on the site every ten minutes, on the stream every fifteen, halfway between its spots (design 4.1). */
export const STATS_EVERY_MS = 10 * 60_000
export const BROADCAST_STATS_EVERY_MS = 15 * 60_000
/** The first, ms after TV comes on: halfway between the first spot and the second, on the site and on the stream. */
export const STATS_FIRST_MS = 7.5 * 60_000
export const BROADCAST_STATS_FIRST_MS = 7.5 * 60_000
/** The least time between a break and a spot or an explainer, either side, ms: the explainer's own gap from a spot. */
export const STATS_GAP_MS = EXPLAINER_AD_GAP_MS
/** How long after a break that had nothing to show the next is tried, ms. */
export const STATS_RETRY_MS = 60_000
/** How old the counts may get before they are read again, s: the hour they are stamped with. */
export const STATS_HOUR_S = 60 * 60
/** How long after TV comes on the counts are first read, ms: after the tape's own first reads, well before the first break. */
export const STATS_LOAD_DELAY_MS = 60_000
/** Rows on a ranking: the #1 and four more (design 4.3). A ranking with fewer than STATS_MIN_ROWS is skipped. */
export const STATS_ROWS = 5
export const STATS_MIN_ROWS = 3

/**
 * Whether the site's TV counts and plays the boards, as the stream does: ON
 * for now. The owner decides whether site viewers count at all (review of
 * #537); OFF leaves the site with no reads and no breaks of its own.
 */
export const STATS_ON_SITE = true

/** Whether this TV counts and plays the boards: the stream always, the site by STATS_ON_SITE. */
export function statsOn(broadcast: boolean, onSite: boolean = STATS_ON_SITE): boolean {
  return broadcast || onSite
}


/**
 * How long a break waits for the profiles of everyone it could show or count,
 * ms, after they were asked for: whether a key is an agent is in its kind 0.
 */
export const PROFILE_HOLD_MS = 15_000

/** The query that plays one board first, for a look at it: /tv?stats=<board id>. */
export const STATS_PARAM = 'stats'
/** How long after TV comes on a board asked for by the address is due, ms: once its counts are in. */
export const STATS_FORCED_MS = 4_000

/** His words for the ACTIVE USERS card (arkinox, 2026-10-30), as written: never re-cased. */
export const AGENTS_FUN_FACT = 'Fun Fact: use cyberspace-mcp to bring your agent into cyberspace!'

export type BoardId = 'longest-chain' | 'most-bags' | 'most-respawns' | 'most-objects' | 'new-arrivals' | 'active-users'

/** The rotation: a ranking, then a count, in turn. */
export const BOARD_ORDER: BoardId[] = ['longest-chain', 'active-users', 'most-bags', 'new-arrivals', 'most-respawns', 'most-objects']

/** A ranking's title, its one qualifier line, and its card's colours. */
export const BOARD_WORDS: Record<BoardId, { title: string; qualifier: string; theme: AdTheme }> = {
  'longest-chain': { title: 'LONGEST CHAIN', qualifier: 'VALID ACTIONS SINCE LAST SPAWN', theme: 'teal' },
  'active-users': { title: 'ACTIVE USERS', qualifier: 'LAST 7 DAYS', theme: 'night' },
  'most-bags': { title: 'MOST BAGS HIDDEN', qualifier: 'BAGS SEALED, EACH IN ITS OWN PLACE', theme: 'magenta' },
  'new-arrivals': { title: 'NEW ARRIVALS', qualifier: 'THIS WEEK', theme: 'teal' },
  'most-respawns': { title: 'MOST RESPAWNS', qualifier: 'RESPAWNED AND KEPT GOING', theme: 'night' },
  'most-objects': { title: 'MOST OBJECTS PUBLISHED', qualifier: 'OBJECTS PUBLISHED, EACH A NEW SHAPE', theme: 'magenta' },
}

/** One row of a ranking: where, who, how many. Nothing else, ever (design 3.3 L1, L2). */
export interface StatsRow {
  rank: number
  pubkey: string
  value: number
}

/** A count this week and the week before it. */
export interface WeekCount {
  now: number
  before: number
}

interface BoardBase {
  id: BoardId
  title: string
  qualifier: string
  theme: AdTheme
  /** The moment it is counted to, unix s: on the hour. */
  asOf: number
}

/** What a break shows. */
export type StatsBoard =
  | (BoardBase & { kind: 'ranking'; rows: StatsRow[] })
  | (BoardBase & { kind: 'count'; count: WeekCount })
  | (BoardBase & { kind: 'split'; humans: WeekCount; agents: WeekCount; note: string })

/**
 * Every number the boards rank or count, as of one hour: the seam between
 * counting and showing. Per key, for the rankings; the keys active in each
 * week, for ACTIVE USERS, which are told apart as humans or agents only when
 * shown (profiles arrive later than counts).
 */
export interface StatsSnapshot {
  asOf: number
  chain: Map<string, number>
  respawns: Map<string, number>
  bags: Map<string, number>
  objects: Map<string, number>
  /** Each key's first v2 spawn, unix s: NEW ARRIVALS, and a ranking's tie-break. */
  arrivals: Map<string, number>
  /** Keys with a valid action in (asOf - WEEK_S, asOf], and in the week before that. */
  active: string[]
  activeBefore: string[]
}

/** What the counting reads: every v2 movement event, the census's bags and objects, and their deletions. */
export interface StatsInput {
  actions: NostrEvent[]
  bags: BagRecord[]
  objects: ObjectRecord[]
  deletions: Deletion[]
  arrivals: Map<string, number>
}

/** The hour `nowS` is in, unix s: what a board is counted to and stamped with. */
export function asOfHour(nowS: number): number {
  return Math.floor(nowS / STATS_HOUR_S) * STATS_HOUR_S
}

/** Hand the page back now and then while counting, so the picture keeps moving. */
const breathe = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/**
 * Count everything, as of `asOf`. Each key's chains are built once
 * (lib/countingRules keyChains); between keys the page gets its turn when
 * `yieldEvery` keys have been counted (0: never, for tests).
 */
export async function countStats(input: StatsInput, asOf: number, yieldEvery = 40): Promise<StatsSnapshot> {
  const by = actionsByAuthor(input.actions)
  const chain = new Map<string, number>()
  const respawns = new Map<string, number>()
  const active: string[] = []
  let n = 0
  for (const [pk, evs] of by) {
    const k = keyChains(evs, pk, asOf)
    if (k.chainLength > 0) chain.set(pk, k.chainLength)
    if (k.respawns > 0) respawns.set(pk, k.respawns)
    if (k.activeWeek) active.push(pk)
    if (yieldEvery > 0 && ++n % yieldEvery === 0) await breathe()
  }
  // The week before, the page getting its turn as above.
  const activeBefore: string[] = []
  n = 0
  for (const [pk, evs] of by) {
    if (activeKeys(new Map([[pk, evs]]), asOf - 2 * WEEK_S, asOf - WEEK_S).length > 0) activeBefore.push(pk)
    if (yieldEvery > 0 && ++n % yieldEvery === 0) await breathe()
  }
  const arrivals = new Map([...input.arrivals].filter(([, at]) => at <= asOf))
  return {
    asOf,
    chain,
    respawns,
    bags: bagsHidden(input.bags, input.deletions, asOf),
    objects: objectsPublished(input.objects, input.deletions, asOf),
    arrivals,
    active,
    activeBefore,
  }
}

/**
 * The one read the census does not make: the v2 movement events, which the
 * chain rules need (ruling D2). From V2_EPOCH, never v1's history (review of
 * #537: unscoped, a read paged through thousands of v1 events); scoped by
 * time and not by `A`, because a chain is followed through every event
 * whatever its `A` (spec 8.9 rule 1), and leaving out a game's own actions
 * would cut chains short. `since` for a read of what is new. The bags,
 * objects and their deletions are the census's (lib/tv/stats loadCensus).
 */
export async function loadStatsReads(ask: Ask, since: number = V2_EPOCH): Promise<{ actions: NostrEvent[] }> {
  return { actions: await askAll(ask, { kinds: [ACTION_KIND], since: Math.max(V2_EPOCH, since) }) }
}

/** The movement events read so far, by id, and when they were read: a later read asks only for what is new. */
export interface ActionStore {
  byId: Map<string, NostrEvent>
  /** When the last read was made, and the last whole one, unix s. */
  readAt: number
  wholeAt: number
}

/**
 * Read the movement events, whole the first time and once a READ_WHOLE_S,
 * otherwise only those since the last read less READ_OVERLAP_S, into `kept`
 * (a new store when null). Returns the store, every event in it.
 */
export async function readActions(ask: Ask, kept: ActionStore | null, nowS: number): Promise<ActionStore> {
  const whole = !kept || nowS - kept.wholeAt >= READ_WHOLE_S
  const { actions } = await loadStatsReads(ask, whole ? V2_EPOCH : kept.readAt - READ_OVERLAP_S)
  const byId = whole ? new Map<string, NostrEvent>() : new Map(kept.byId)
  for (const e of actions) byId.set(e.id, e)
  return { byId, readAt: nowS, wholeAt: whole ? nowS : kept.wholeAt }
}

/**
 * Whether a profile is an agent's, by the agents ruling: its kind 0 says
 * `bot: true` and names an operator with a `p` tag marked `operator`
 * (store/useProfiles parseProfile, lib/agentInvite namesOperator). A bot flag
 * alone is not enough.
 */
export function isAgentProfile(p: { bot?: true; operator?: string } | null | undefined): boolean {
  return p?.bot === true && typeof p.operator === 'string' && p.operator.length > 0
}

/**
 * Who a board leaves out: agents, always, from the rankings; a key whose
 * profile is not known (`isKnown` false: no answer about its kind 0 yet), from
 * the rankings and from both HUMANS and AGENTS; and whoever the viewer has
 * blocked, from the rankings.
 */
export interface StatsFilter {
  isAgent: (pubkey: string) => boolean
  isKnown?: (pubkey: string) => boolean
  hidden?: (pubkey: string) => boolean
}

/** Whether every key's profile is known, or the hold for them is over: a break may then show them (PROFILE_HOLD_MS). */
export function profilesSettled(keys: string[], isKnown: (pubkey: string) => boolean, askedAt: number, now: number): boolean {
  return now - askedAt >= PROFILE_HOLD_MS || keys.every(isKnown)
}

/**
 * A ranking's rows, in order: the higher number first, then the earlier
 * arrival, then the pubkey's order (design 2.2 Ties; the first spawn stands
 * in for the service's first-seen until there is one). Equal numbers share
 * a rank (1, 1, 3), the way a table of standings writes it. Zeros are not on
 * it, nor agents, nor keys not known, nor the blocked.
 */
export function rankRows(values: Map<string, number>, arrivals: Map<string, number>, filter: StatsFilter, rows = STATS_ROWS): StatsRow[] {
  const known = filter.isKnown ?? (() => true)
  const sorted = [...values]
    .filter(([pk, v]) => v > 0 && known(pk) && !filter.isAgent(pk) && !filter.hidden?.(pk))
    .sort(([a, x], [b, y]) => y - x || (arrivals.get(a) ?? Infinity) - (arrivals.get(b) ?? Infinity) || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, rows)
  return sorted.map(([pubkey, value]) => ({ rank: sorted.findIndex(([, v]) => v === value) + 1, pubkey, value }))
}

/** The keys a snapshot will name or count, for their profiles to be asked for before a break needs them. */
export function keysToKnow(snap: StatsSnapshot, depth = 3 * STATS_ROWS): string[] {
  const top = (m: Map<string, number>): string[] => [...m].sort((a, b) => b[1] - a[1]).slice(0, depth).map(([pk]) => pk)
  return [...new Set([...top(snap.chain), ...top(snap.respawns), ...top(snap.bags), ...top(snap.objects), ...snap.active, ...snap.activeBefore])]
}

/** One board from a snapshot, or null when it has nothing worth showing (a ranking under STATS_MIN_ROWS rows). */
export function boardFor(id: BoardId, snap: StatsSnapshot, filter: StatsFilter): StatsBoard | null {
  const base = { id, ...BOARD_WORDS[id], asOf: snap.asOf }
  const ranking = (values: Map<string, number>): StatsBoard | null => {
    const rows = rankRows(values, snap.arrivals, filter)
    return rows.length >= STATS_MIN_ROWS ? { ...base, kind: 'ranking', rows } : null
  }
  switch (id) {
    case 'longest-chain': return ranking(snap.chain)
    case 'most-bags': return ranking(snap.bags)
    case 'most-respawns': return ranking(snap.respawns)
    case 'most-objects': return ranking(snap.objects)
    case 'new-arrivals':
      return { ...base, kind: 'count', count: { now: arrivalsIn(snap.arrivals, snap.asOf - WEEK_S, snap.asOf), before: arrivalsIn(snap.arrivals, snap.asOf - 2 * WEEK_S, snap.asOf - WEEK_S) } }
    case 'active-users': {
      // A key not known is in neither count: never guessed a human.
      const known = filter.isKnown ?? (() => true)
      const agents = (keys: string[]): number => keys.filter((pk) => known(pk) && filter.isAgent(pk)).length
      const humans = (keys: string[]): number => keys.filter((pk) => known(pk) && !filter.isAgent(pk)).length
      return {
        ...base,
        kind: 'split',
        humans: { now: humans(snap.active), before: humans(snap.activeBefore) },
        agents: { now: agents(snap.active), before: agents(snap.activeBefore) },
        note: AGENTS_FUN_FACT,
      }
    }
  }
}

/** The board after `last` in BOARD_ORDER that has something to show, starting from `first` when given and none has played; null for none. */
export function nextBoard(snap: StatsSnapshot, filter: StatsFilter, last: BoardId | null, first: BoardId | null = null): StatsBoard | null {
  if (last === null && first !== null) {
    const f = boardFor(first, snap, filter)
    if (f) return f
  }
  const at = last === null ? -1 : BOARD_ORDER.indexOf(last)
  for (let i = 1; i <= BOARD_ORDER.length; i++) {
    const b = boardFor(BOARD_ORDER[(at + i) % BOARD_ORDER.length], snap, filter)
    if (b) return b
  }
  return null
}

/** The board an address asks to play first (/tv?stats=<id>), or null. */
export function forcedBoard(search: string): BoardId | null {
  try {
    const v = new URLSearchParams(search).get(STATS_PARAM)
    return v && (BOARD_ORDER as string[]).includes(v) ? (v as BoardId) : null
  } catch {
    return null
  }
}

/**
 * A break's beats, seconds after its cut (design 4.3): the title slams in,
 * then the rows decode in from the bottom (rows 5 to 2), then the #1 with its
 * splash and its avatar turning, then the stamp. A count shows its numbers
 * where a ranking shows its rows.
 */
export const BEATS = {
  ranking: { rows: 2, top: 7, stamp: 13, end: 16.5 },
  count: { rows: 2, top: 2, stamp: 8, end: 11 },
  split: { rows: 2, top: 2, stamp: 9.5, end: 13 },
} as const

/** How long a board's break runs, seconds, after its cut. */
export function statsLength(board: StatsBoard): number {
  return BEATS[board.kind].end
}

/** When the row at `position` (1 the top) starts decoding in, seconds: the bottom one first, one a second, the top one at its own beat. */
export function rowStart(position: number, rows: number): number {
  return position === 1 ? BEATS.ranking.top : BEATS.ranking.rows + (rows - position) * 1.1
}

/** Three letters a month, as the tape's clock writes them (scene/tvPainter tapeStamp). */
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** The stamp's second line: AS OF 30 OCT 02:00 UTC. */
export function asOfWords(asOf: number): string {
  const d = new Date(asOf * 1000)
  const two = (n: number): string => String(n).padStart(2, '0')
  return `AS OF ${two(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`
}

/** A number as a board writes it: thousands separated by commas. */
export function statNumber(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString('en-US')
}

/** Everything the break's clock is weighed against, ms of performance.now(). */
export interface BreakClock {
  now: number
  /** When this break is due. */
  due: number
  /** The tape is playing (not tuning, no signal, or the end). */
  playing: boolean
  /** A spot or an explainer is on screen or getting ready. */
  busy: boolean
  /** When the next spot and the next explainer are due (Infinity for none), and when the last of each ended. */
  adDue: number
  adEndedAt: number
  explainerDue: number
  explainerEndedAt: number
  /** How long this break runs, ms, its cut included. */
  length: number
}

/**
 * Whether a break may start now: due, the tape playing, nothing else on, and
 * STATS_GAP_MS clear of every spot and explainer either side, the coming
 * ones included, so a spot or an explainer never waits on a board; a board
 * that comes due then waits for them instead (design 4.1).
 */
export function breakMayStart(c: BreakClock): boolean {
  if (c.now < c.due || !c.playing || c.busy) return false
  if (c.now - c.adEndedAt < STATS_GAP_MS || c.now - c.explainerEndedAt < STATS_GAP_MS) return false
  const clear = c.length + STATS_GAP_MS
  return c.adDue - c.now >= clear && c.explainerDue - c.now >= clear
}

/** How often a break plays, ms: on the site, or on the stream. */
export function statsEveryMs(broadcast: boolean): number {
  return broadcast ? BROADCAST_STATS_EVERY_MS : STATS_EVERY_MS
}

/** When the first break is due, ms after TV comes on. */
export function statsFirstMs(broadcast: boolean): number {
  return broadcast ? BROADCAST_STATS_FIRST_MS : STATS_FIRST_MS
}

/** The keys a board names, for a check that it names only keys: no place in any field. */
export function boardKeys(board: StatsBoard): string[] {
  return board.kind === 'ranking' ? board.rows.map((r) => r.pubkey) : []
}
