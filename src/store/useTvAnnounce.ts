/**
 * useTvAnnounce.ts: Cyberspace TV's UPGRADE ANNOUNCEMENT, run (what it says
 * and when: lib/tv/upgradeAnnounce; the tube draws it: scene/tvPainter).
 *
 * One way in: playUpgradeAnnouncement({ version, text }). Whatever carries
 * announcements later (not decided yet) calls it, and nothing else. It plays
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
 * is said). And afterUpgradeAnnouncement, called once each has played
 * through and TV is back: the 24/7 stream will reload there to pick up the
 * new version. Not done yet; nothing listens today.
 */

import { create } from 'zustand'
import {
  ANNOUNCE_IN_MS, ANNOUNCE_TEST_MS, SAMPLE_ANNOUNCEMENT, SAMPLE_UPDATES, announceMs, announcePlan, announceTestAsked, screenStarts,
  type AnnouncePlan, type UpgradeAnnouncement,
} from '../lib/tv/upgradeAnnounce'
import { holdExplainer, releaseExplainer, useTvExplainer } from './useTvExplainer'
import { duckMusicForExplainer } from './useTvMusic'
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
}

export const useTvAnnounce = create<AnnounceState>(() => ({ showing: null, updatesThisWeek: null }))

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
    waiting = [...waiting, plan].slice(-QUEUE_MAX)
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
 * picked up again: for a run of them, each once the last is over. The 24/7 stream will reload here, later, to run the new
 * version. Returns how to stop listening.
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
  waiting = []
  played = []
  heldAt = null
  if (ducked) { ducked = false; duckMusicForExplainer(false) }
  if (useTvAnnounce.getState().showing) useTvAnnounce.setState({ showing: null })
}

/** How many wait behind the one on screen: for tests. */
export function announceWaitingForTest(): number {
  return waiting.length
}
