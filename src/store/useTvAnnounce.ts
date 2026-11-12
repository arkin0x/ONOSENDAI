/**
 * useTvAnnounce.ts: Cyberspace TV's UPGRADE ANNOUNCEMENT, run (what it says
 * and when: lib/tv/upgradeAnnounce; the tube draws it: scene/tvPainter).
 *
 * One way in: playUpgradeAnnouncement({ version, text }). What carries
 * announcements (listenForAnnouncements, below: the announcer's signed kind
 * 33338 events, lib/tv/announceFeed) calls it, and nothing else. It plays
 * at once, over whatever TV is showing, which stops where it is:
 *
 * - The tape: TV's engine (store/useTv) stops ticking it, and when this is
 *   over moves every clock it keeps on by the time it held (resumeTv), so
 *   the shot on screen plays on from the moment it stopped, beats and
 *   camera alike; and so does a spot or a CYBERSPACE STATS board, from the
 *   scene it was on. The breaks due, and the screen time of whoever is on,
 *   do not count it.
 * - An explainer: its video pauses where it is (store/useTvExplainer
 *   holdExplainer), and plays on from there after (releaseExplainer).
 * - The music plays on under it, ducked as it is under an explainer
 *   (store/useTvMusic duckMusicForExplainer, EXPLAINER_DUCK), and comes back
 *   to its own level after, unless an explainer it stopped still has it ducked.
 *
 * Another that comes while one plays waits for it, and plays straight after
 * (at most QUEUE_MAX waiting); TV picks up once the last is over.
 *
 * Also here, for the same carrier to feed: how many updates came this week,
 * for the marquee (setUpdatesThisWeek; unknown until told, and then nothing
 * is said), and the highest version announced this week (announcedVersion),
 * which the marquee shows when it is above the build this page runs. And
 * afterUpgradeAnnouncement, called once each has played through and TV is
 * back. Nothing listens to that: the stream does not reload straight after
 * an announcement (owner, 2026-11-12).
 *
 * The stream's gentle self-update instead (owner, 2026-11-12; watchForSelfUpdate,
 * maybeSelfUpdate): on the broadcast only, between two songs, once nothing
 * else is on (no announcement playing or due, no explainer, no HOSAKA spot,
 * no CYBERSPACE STATS board), the page reloads (lib/tv/broadcast
 * reloadBroadcast, as its other reloads) when a version above the one it
 * runs has been announced, at most once a day (lib/tv/announceFeed
 * selfUpdateWanted). The site's /tv never reloads.
 *
 * listenForAnnouncements: once TV's first shot is up (store/useTv, as the
 * ticker's numbers wait), one live subscription to the announcer's events of
 * the last week, on the relays TV reads. What is stored is gathered until
 * the relays have sent it (or ANNOUNCE_GATHER_MS), then each fresh version
 * this set has not played plays, lowest first; one that arrives later, while
 * TV runs, plays as it comes. Each plays once a set (lib/tv/announceFeed
 * rememberPlayed, kept on the device). The week is counted again every
 * ANNOUNCE_RECOUNT_MS, as it moves on.
 */

import { create } from 'zustand'
import {
  ANNOUNCE_IN_MS, ANNOUNCE_TEST_MS, SAMPLE_ANNOUNCEMENT, SAMPLE_UPDATES, announceMs, announcePlan, announceTestAsked, appVersion, screenStarts,
  type AnnouncePlan, type UpgradeAnnouncement,
} from '../lib/tv/upgradeAnnounce'
import { ANNOUNCER_PUBKEY, AnnounceBook, announceFilter, lastSelfUpdate, readAnnouncement, rememberPlayed, rememberSelfUpdate, selfUpdateWanted, wasPlayed } from '../lib/tv/announceFeed'
import { isBroadcast, reloadBroadcast, reloadWouldWait } from '../lib/tv/broadcast'
import { subscribe } from '../lib/relay'
import type { NostrEvent } from '../lib/events'
import { holdExplainer, releaseExplainer, useTvExplainer } from './useTvExplainer'
import { duckMusicForExplainer, onSongEnd } from './useTvMusic'
import { tvIsOn } from './tvOn'

/** The announcement on screen: its plan, and since when (performance.now()), the cut into it included. */
export interface AnnounceShowing {
  at: number
  plan: AnnouncePlan
}

interface AnnounceState {
  showing: AnnounceShowing | null
  /** How many updates came this week, for the marquee; null until something says. */
  updatesThisWeek: number | null
  /** The highest version announced this week, or null for none heard: the marquee shows it when it is above this build's. */
  announcedVersion: string | null
}

export const useTvAnnounce = create<AnnounceState>(() => ({ showing: null, updatesThisWeek: null, announcedVersion: null }))

/** The most announcements waiting behind the one on screen; one more pushes out the oldest waiting. */
export const QUEUE_MAX = 3

/** What waits behind the one on screen. */
let waiting: AnnouncePlan[] = []
/** When TV stopped for the first of a run of them, performance.now(); null when it is not stopped. */
let heldAt: number | null = null
/** When the last one ended, performance.now(): the tube cuts back to TV there. */
let endedAt = -Infinity
/** Whether this put the music down, so only this puts it back. */
let ducked = false
let testTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<(a: UpgradeAnnouncement) => void>()
/** What each plan on screen or waiting was made from, for afterUpgradeAnnouncement. */
const asked = new WeakMap<AnnouncePlan, UpgradeAnnouncement>()
/** Those played through in this run of them, told of together once TV is back. */
let played: UpgradeAnnouncement[] = []

/**
 * Play an UPGRADE ANNOUNCEMENT now, over whatever TV is showing, or straight
 * after the one playing. False when it does not play: TV is off (there is
 * nothing to interrupt, and nobody watching), or it has no version.
 */
export function playUpgradeAnnouncement(a: UpgradeAnnouncement, now: number = performance.now()): boolean {
  if (!tvIsOn() || !a || typeof a !== 'object') return false
  const plan = announcePlan(a)
  if (!plan) return false
  asked.set(plan, a)
  if (useTvAnnounce.getState().showing) {
    const all = [...waiting, plan]
    waiting = all.slice(-QUEUE_MAX)
    for (const out of all.slice(0, -QUEUE_MAX)) dropped(out)
    return true
  }
  begin(plan, now)
  return true
}

/** How many updates came this week, for the marquee: a count, or null for unknown (nothing said). */
export function setUpdatesThisWeek(n: number | null): void {
  const v = typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
  if (useTvAnnounce.getState().updatesThisWeek !== v) useTvAnnounce.setState({ updatesThisWeek: v })
}

/**
 * Called with each announcement once it has played through and TV has
 * picked up again: for a run of them, each once the last is over. Nothing
 * listens today: the 24/7 stream does not reload for an update (owner,
 * 2026-11-12). Returns how to stop listening.
 */
export function afterUpgradeAnnouncement(fn: (a: UpgradeAnnouncement) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Whether one is on screen: TV's engine stands still meanwhile. */
export function announceBusy(): boolean {
  return useTvAnnounce.getState().showing !== null
}

/**
 * Where the tube last cut for an announcement, performance.now(), at or
 * before `now`: into it, from one screen to the next, and back to TV. -Infinity for never.
 */
export function announceCutAt(now: number): number {
  const s = useTvAnnounce.getState().showing
  if (!s) return endedAt <= now ? endedAt : -Infinity
  let at = s.at
  for (const from of screenStarts(s.plan)) {
    const edge = s.at + ANNOUNCE_IN_MS + from * 1000
    if (edge <= now) at = edge
  }
  return at
}

function begin(plan: AnnouncePlan, now: number): void {
  shown(plan)
  if (heldAt === null) {
    heldAt = now
    holdExplainer(now)
    duckMusicForExplainer(true)
    ducked = true
  }
  useTvAnnounce.setState({ showing: { at: now, plan } })
}

/**
 * One tick of TV's engine, before anything else it does. True while one is
 * on screen (the engine does nothing more this tick). When the last is over,
 * `resumeTv` is told how long TV stood still, so it moves its clocks on by
 * that; then the explainer and the music go on, and afterUpgradeAnnouncement
 * hears of it. False then, and the engine ticks on as ever.
 */
export function announceTick(now: number, resumeTv: (heldMs: number, now: number) => void): boolean {
  const s = useTvAnnounce.getState().showing
  if (!s) return false
  if (now - s.at < announceMs(s.plan)) return true
  const done = asked.get(s.plan)
  if (done) played.push(done)
  const next = waiting.shift()
  if (next) {
    shown(next)
    useTvAnnounce.setState({ showing: { at: now, plan: next } })
    return true
  }
  const held = heldAt === null ? 0 : Math.max(0, now - heldAt)
  heldAt = null
  endedAt = now
  useTvAnnounce.setState({ showing: null })
  resumeTv(held, now)
  releaseExplainer(now)
  putMusicBack()
  const heard = played
  played = []
  for (const a of heard) tell(a)
  return false
}

/** The music back to its own level, unless an explainer that plays on still has it down. */
function putMusicBack(): void {
  if (!ducked) return
  ducked = false
  const ex = useTvExplainer.getState().showing
  if (!ex || ex.phase === 'out') duckMusicForExplainer(false)
}

function tell(a: UpgradeAnnouncement): void {
  for (const fn of [...listeners]) {
    try { fn(a) } catch (e) { console.error('[onosendai] afterUpgradeAnnouncement:', e) }
  }
}

/**
 * TV came on: /tv?announce=test plays SAMPLE_ANNOUNCEMENT ANNOUNCE_TEST_MS
 * in, once the first shot is up, and puts SAMPLE_UPDATES on the marquee.
 */
export function startAnnouncements(search: string = typeof window !== 'undefined' && window.location ? window.location.search : ''): void {
  stopAnnouncements()
  if (!announceTestAsked(search)) return
  setUpdatesThisWeek(SAMPLE_UPDATES)
  testTimer = setTimeout(() => { testTimer = null; playUpgradeAnnouncement(SAMPLE_ANNOUNCEMENT) }, ANNOUNCE_TEST_MS)
}

/** TV went off: the one on screen and those waiting go, unheard. The explainer and the music are TV's to stop. */
export function stopAnnouncements(): void {
  if (testTimer !== null) clearTimeout(testTimer)
  testTimer = null
  stopFeed()
  stopSelfUpdate()
  waiting = []
  played = []
  heldAt = null
  if (ducked) { ducked = false; duckMusicForExplainer(false) }
  if (useTvAnnounce.getState().showing) useTvAnnounce.setState({ showing: null })
}

/** How long what the relays hold is gathered before any of it plays, ms, when they have not all said they are done. */
export const ANNOUNCE_GATHER_MS = 5_000
/** How often the week is counted again, ms: an announcement leaves the count a week after it came. */
export const ANNOUNCE_RECOUNT_MS = 10 * 60_000

type Subscribe = (filter: ReturnType<typeof announceFilter>, onEvent: (ev: NostrEvent) => void, onEose?: () => void) => () => void
/** The relay subscription the feed uses: lib/relay subscribe, but in tests. */
let subscribeFeed: Subscribe | null = null
let nowSeconds = (): number => Date.now() / 1000
/** The key believed: the pinned announcer, but in tests (setAnnounceFeedForTest). */
let announcer = ANNOUNCER_PUBKEY

interface Feed {
  book: AnnounceBook
  /** Whether what the relays held has been gathered: from then on, what is heard plays at once. */
  gathered: boolean
  /** Versions handed to playUpgradeAnnouncement that have not come on screen yet: not handed again meanwhile. */
  queued: Set<string>
  unsubscribe: () => void
  gatherTimer: ReturnType<typeof setTimeout>
  recountTimer: ReturnType<typeof setInterval>
}
let feed: Feed | null = null

/**
 * TV's first shot is up: listen for the announcer's announcements (above).
 * Once a run of TV; nothing for /tv?announce=test, which plays the sample.
 */
export function listenForAnnouncements(search: string = typeof window !== 'undefined' && window.location ? window.location.search : ''): void {
  if (feed || !tvIsOn() || announceTestAsked(search)) return
  const gathered = (): void => {
    if (feed !== f || f.gathered) return
    f.gathered = true
    refresh(f)
  }
  const f: Feed = {
    book: new AnnounceBook(), gathered: false, queued: new Set(), unsubscribe: () => {},
    gatherTimer: setTimeout(gathered, ANNOUNCE_GATHER_MS),
    recountTimer: setInterval(() => { if (feed === f && f.gathered) refresh(f) }, ANNOUNCE_RECOUNT_MS),
  }
  feed = f
  f.unsubscribe = (subscribeFeed ?? subscribe)(announceFilter(nowSeconds(), announcer), (ev) => {
    if (feed !== f) return
    const a = readAnnouncement(ev, announcer)
    if (a && f.book.add(a) && f.gathered) refresh(f)
  }, gathered)
}

/** The week counted, its highest version told to the marquee, and what is due played. */
function refresh(f: Feed): void {
  const now = nowSeconds()
  setUpdatesThisWeek(f.book.count(now))
  const newest = f.book.newest(now)
  if (useTvAnnounce.getState().announcedVersion !== newest) useTvAnnounce.setState({ announcedVersion: newest })
  for (const a of f.book.due(now, (v) => wasPlayed(v, now))) {
    if (f.queued.has(a.version)) continue
    f.queued.add(a.version)
    if (!playUpgradeAnnouncement({ version: a.version, text: a.text })) f.queued.delete(a.version)
  }
}

/**
 * One goes on screen: a version the feed handed over is played on this set
 * from now (lib/tv/announceFeed rememberPlayed), and not before: one pushed
 * out of the queue, or still waiting when TV goes off, plays another time.
 */
function shown(plan: AnnouncePlan): void {
  const a = asked.get(plan)
  const f = feed
  if (!a || !f || !f.queued.delete(a.version)) return
  rememberPlayed(a.version, nowSeconds())
}

/** One pushed out of the queue (QUEUE_MAX): the feed may hand it over again at its next count. */
function dropped(plan: AnnouncePlan): void {
  const a = asked.get(plan)
  if (a) feed?.queued.delete(a.version)
}

/** TV's own word on whether it is quiet (no HOSAKA spot, no CYBERSPACE STATS board): store/useTv's, which this cannot import. */
let tvQuiet: () => boolean = () => false
let offSongEnd: (() => void) | null = null

/**
 * TV came on: on the broadcast, look for a quiet moment to reload for a new
 * version at each song's end (maybeSelfUpdate). `quiet` is TV's own word
 * that nothing of its own is on. Nothing off the broadcast.
 */
export function watchForSelfUpdate(quiet: () => boolean): void {
  stopSelfUpdate()
  if (!isBroadcast()) return
  tvQuiet = quiet
  offSongEnd = onSongEnd(() => { maybeSelfUpdate() })
}

/**
 * A song has ended: reload the broadcast now when a newer version has been
 * announced, the day's one reload is not spent, and nothing is on. True when
 * it reloads. Every announcement heard plays first: none playing or
 * waiting, and none due that this set has not played.
 */
export function maybeSelfUpdate(): boolean {
  const f = feed
  if (!isBroadcast() || !f || !f.gathered || !tvIsOn()) return false
  const now = nowSeconds()
  if (!selfUpdateWanted(appVersion(), f.book.newest(now), lastSelfUpdate(), now)) return false
  if (announceBusy() || f.book.due(now, (v) => wasPlayed(v, now)).length > 0) return false
  if (useTvExplainer.getState().showing || !tvQuiet()) return false
  // A stream already reloading over and over waits out its backoff (reloadBroadcast): that reload would land at no quiet moment.
  if (reloadWouldWait()) return false
  rememberSelfUpdate(now)
  reloadBroadcast()
  return true
}

function stopSelfUpdate(): void {
  offSongEnd?.()
  offSongEnd = null
  tvQuiet = () => false
}

function stopFeed(): void {
  const f = feed
  if (!f) return
  feed = null
  f.unsubscribe()
  clearTimeout(f.gatherTimer)
  clearInterval(f.recountTimer)
}

/**
 * For tests: the relay subscription, the clock (unix s) and the key the feed
 * believes (tests cannot sign as the pinned announcer); null puts back the real ones.
 */
export function setAnnounceFeedForTest(sub: Subscribe | null, clock: (() => number) | null = null, key: string | null = null): void {
  subscribeFeed = sub
  nowSeconds = clock ?? ((): number => Date.now() / 1000)
  // The pinned key is swapped only under the test runner: no other build can un-pin it.
  announcer = key && import.meta.env.MODE === 'test' ? key : ANNOUNCER_PUBKEY
}

/** How many wait behind the one on screen: for tests. */
export function announceWaitingForTest(): number {
  return waiting.length
}
