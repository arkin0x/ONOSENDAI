/**
 * useTv.ts: Cyberspace TV, the tape of everything that ever happened here,
 * played back from a random point in its history (arkinox, 2026-10-18).
 *
 * The store runs the tape: lib/tv/tape.ts reads the history forward in
 * windows, lib/tv/director.ts cuts it into shots, and the engine here plays
 * each shot against the clock: one beat (one action) at a time, at the
 * offsets the director chose. What the scene draws is `avatars`, where every
 * avatar the tape has shown was last seen, and the camera is the ordinary
 * view (useCyberspace focusOn) pointed at the shot's avatar at a zoom that
 * fits the whole shot, then orbited from above by scene/TvLayer.
 *
 * Watching only: nothing here signs or publishes, and leaving puts the view
 * back where it was (clearFocus).
 */

import { create } from 'zustand'
import { queryEach } from '../lib/relay'
import { Director, MAX_SHOT_S, isJump, shotFraming, type Beat, type Framing, type Shot, type TapeItem } from '../lib/tv/director'
import type { HintBox } from '../lib/hint'
import { TapeReader, V2_EPOCH, randomStart, type Ask } from '../lib/tv/tape'
import { loadCensus, loadChainTimes, type Census, type ChainTimes } from '../lib/tv/stats'
import { MAX_SCALE_EXP, type Position } from '../lib/space'
import { useCyberspace } from './useCyberspace'
import { spectate, stopSpectating } from '../lib/spectator'
import { useBuilder } from './useBuilder'
import { useShards } from './useShards'
import { useDemo } from './useDemo'
import { useCoordRoute } from './useCoordRoute'
import { usePersonCard } from './usePersonCard'

/** Where an avatar stands on the tape, and since when. */
export interface TvAvatar {
  position: Position
  plane: number
  /** Tape time it got there. */
  at: number
}

export type TvStatus = 'tuning' | 'playing' | 'end' | 'no-signal'

interface TvState {
  on: boolean
  status: TvStatus
  /** The shot on screen. */
  shot: Shot | null
  /** How many of its beats have played. */
  played: number
  /** Tape time on screen: the last beat played, or the shot's start before its first. */
  tapeTime: number | null
  avatars: Record<string, TvAvatar>
  /** performance.now() of the last cut, for the static between shots. */
  cutAt: number
  /** Seconds of dead air skipped to reach this shot (zero for a shot that follows straight on). */
  skipped: number
  /** The zoom this shot is framed at. */
  scaleExp: number
  /** How close and how steep the camera is for this shot (shotFraming). */
  framing: Framing
  /** This shot starts before the last one ended: the tape went back a little to show it, and says MEANWHILE. */
  meanwhile: boolean
  /** The newest arrivals on tape (spawns that went nowhere), newest last, for the ticker. */
  arrivals: Array<{ pubkey: string; at: number }>
  /** The ticker's counts (lib/tv/stats.ts), once read. */
  census: Census | null
  /** Each on-screen avatar's chain, for its length at tape time. */
  chains: Record<string, ChainTimes>
  /** The hint boxes of the bags the tape has shown, whose outlines stay in the world (TvLayer). */
  boxes: Array<{ id: string; hint: HintBox }>
  /** Turn the set on; false when something else owns the camera (tvBlocked). */
  start: () => boolean
  /** A new random start, the set staying on (RETRY). */
  retune: () => void
  stop: () => void
}

/** Shots kept ready ahead of the one playing; fewer and the reader reads on. */
const QUEUE_LOW = 6
/** How often the engine looks at the clock. A beat is never late by more than this. */
const TICK_MS = 100
/** A shot is framed so its whole path fits in about this many cells across. */
export const FIT_CELLS = 12
/** How close the avatar may get to the edge of the frame's anchor before the view re-anchors on it. */
const REANCHOR_CELLS = 16
/** How many arrivals the ticker keeps. */
const ARRIVALS_KEPT = 4
/** After the tape catches up with now, how long END OF TAPE stays up before a new random start. */
const END_HOLD_MS = 6000
/** The focus label TV's views carry (what a stray FocusBar would say). */
export const TV_FOCUS_LABEL = 'CYBERSPACE TV'
/** Where TV lives, for a link or a screen left running. */
export const TV_PATH = '/tv'
const PUSHED = 'onosendaiTv'

/**
 * The zoom that shows every place in `beats` (and where they started) within
 * FIT_CELLS. A first beat that is a jump is a cut (shotOpening): where it
 * jumped from is not in the shot, and fitting it in framed three one-gibson
 * hops after a hyperjump at 2^59 (review of #370).
 */
export function fitScale(beats: Beat[]): number {
  let extent = 0n
  for (const axis of ['x', 'y', 'z'] as const) {
    let lo: bigint | null = null
    let hi: bigint | null = null
    for (const [i, b] of beats.entries()) {
      const places = i === 0 && isJump(b) ? [b.action.position[axis]] : [b.from.position[axis], b.action.position[axis]]
      for (const v of places) {
        if (lo === null || v < lo) lo = v
        if (hi === null || v > hi) hi = v
      }
    }
    if (lo !== null && hi !== null && hi - lo > extent) extent = hi - lo
  }
  let exp = 0
  while ((extent >> BigInt(exp)) > BigInt(FIT_CELLS) && exp < MAX_SCALE_EXP) exp++
  return exp
}

function cells(a: Position, b: Position, scaleExp: number): number {
  const d = (u: bigint, v: bigint): bigint => (u > v ? u - v : v - u) >> BigInt(scaleExp)
  const m = [d(a.x, b.x), d(a.y, b.y), d(a.z, b.z)].reduce((p, q) => (q > p ? q : p))
  return m > 1_000_000n ? Infinity : Number(m)
}

// The engine: one tape at a time. `run` changes when TV is turned on or off,
// `tape` on every new random start within a run: a read or a timer from an
// old tape checks both, so nothing of it reaches the next (review of #370).
let run = 0
let tape = 0
let reader: TapeReader | null = null
let director: Director | null = null
let queue: Shot[] = []
/** The tape a read is under way for, or -1: a read stuck on an old tape never holds up a new one. */
let readingTape = -1
let shotBegan = 0
let timer: number | null = null
let ask: Ask = (f) => queryEach(f)
/** When the reader may ask again after no relay answered, and how many times in a row that has happened. */
let retryAt = 0
let failures = 0
/** How long to wait after no relay answered, doubling to the most. */
const RETRY_MS = 2000
const RETRY_MAX_MS = 30_000
/** Unanswered reads in a row, with nothing left to play, before the screen says NO SIGNAL. */
const NO_SIGNAL_AFTER = 3

/** How far through the shot on screen the tape is, 0 to 1. */
export function shotProgress(): number {
  const shot = useTv.getState().shot
  if (!shot) return 0
  return Math.min(1, Math.max(0, (performance.now() - shotBegan) / 1000 / shot.length))
}

/**
 * Play a tape item next, cutting the shot on screen short, for `length`
 * seconds when given: for tests and the smoke probe, which cannot wait for a
 * random start to land on one.
 */
export function cueItem(item: TapeItem, length?: number): void {
  const d = new Director()
  d.addItem(item)
  queue.unshift(...d.release(Infinity).map((shot) => (length === undefined ? shot : { ...shot, length })))
  shotBegan = -Infinity
}

/** Swap the relay read, for tests. */
export function setTvAsk(fn: Ask): void { ask = fn }

const live = (id: number, t: number): boolean => id === run && t === tape

async function readMore(id: number, t: number): Promise<void> {
  if (readingTape === t || !reader || !director || performance.now() < retryAt) return
  const r = reader
  const d = director
  readingTape = t
  try {
    while (live(id, t) && queue.length < QUEUE_LOW && !r.caughtUp) {
      const { beats, items } = await r.read()
      if (!live(id, t)) return
      failures = 0
      for (const b of beats) d.add(b)
      for (const item of items) d.addItem(item)
      queue.push(...d.release(r.readTo - 1))
    }
    if (live(id, t) && r.caughtUp) queue.push(...d.release(Infinity))
  } catch {
    // No relay answered: the same window is asked again, later. It is never
    // taken for an empty stretch of history.
    if (!live(id, t)) return
    failures++
    retryAt = performance.now() + Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** (failures - 1))
    if (failures >= NO_SIGNAL_AFTER && queue.length === 0 && useTv.getState().shot === null) useTv.setState({ status: 'no-signal' })
    // A shot still on screen says NO SIGNAL from tick, once it has played out.
  } finally {
    if (readingTape === t) readingTape = -1
  }
}

function frame(position: Position, plane: number, scaleExp: number): void {
  useCyberspace.getState().focusOn(position, plane as 0 | 1, TV_FOCUS_LABEL, scaleExp)
}

function arrive(shot: Shot): void {
  const s = useTv.getState()
  const b = shot.beats[0]
  useTv.setState({
    arrivals: [...s.arrivals, { pubkey: b.pubkey, at: b.at }].slice(-ARRIVALS_KEPT),
    avatars: { ...s.avatars, [b.pubkey]: { position: b.action.position, plane: b.action.plane, at: b.at } },
  })
}

/** The avatars whose chain has been asked for, this session. */
const asked = new Set<string>()

function needChain(pubkey: string, id: number): void {
  if (useTv.getState().chains[pubkey] || asked.has(pubkey)) return
  asked.add(pubkey)
  loadChainTimes(pubkey, ask).then((c) => {
    if (id === run) useTv.setState({ chains: { ...useTv.getState().chains, [pubkey]: c } })
  }, () => { asked.delete(pubkey) })
}

/**
 * Where a shot's avatar is first seen: where it stood before its first
 * action, or, when that action is a jump (a hyperjump, a spawn, a change of
 * plane), where it lands. A jump is a cut, never a fly-over (review of #370).
 */
export function shotOpening(shot: Shot): { position: Position; plane: number } {
  const first = shot.beats[0]
  return isJump(first) ? { position: first.action.position, plane: first.action.plane } : first.from
}

/** How many bag outlines stay in the world at once; the oldest go first. */
const BOXES_KEPT = 12
/** A located bag's box is framed this many powers of two under its own size: about 8 cells across. */
const BOX_FIT = 3

/** The centre of a hint box: its base plus half of each side. */
export function boxCentre(hint: HintBox): Position {
  const half = (h: number): bigint => (h === 0 ? 0n : 1n << BigInt(h - 1))
  return { x: hint.base.x + half(hint.heights[0]), y: hint.base.y + half(hint.heights[1]), z: hint.base.z + half(hint.heights[2]) }
}

/**
 * A segment for a tape item (director TapeItem). A bag whose hint box says
 * where it is is shown there, the camera out far enough to hold the box; one
 * that does not is never placed (its region is the secret), and plays in an
 * inset over the last picture, as an object and a comment do (TvScreen).
 */
function beginSegment(shot: Shot, now: number): void {
  const s = useTv.getState()
  const item = shot.item
  const located = item?.kind === 'bag' && item.hint !== null ? item.hint : null
  const scaleExp = located ? Math.max(0, Math.max(...located.heights) - BOX_FIT) : s.scaleExp
  useTv.setState({
    shot,
    played: 0,
    tapeTime: shot.start,
    scaleExp,
    skipped: s.shot && shot.start > s.shot.end ? shot.start - s.shot.end : 0,
    meanwhile: s.shot !== null && shot.start < s.shot.end,
    status: 'playing',
    cutAt: now,
    ...(located ? { framing: { from: 26, to: 18, polar: 0.6, name: 'wide' as const }, boxes: [...s.boxes.filter((b) => b.id !== shot.id), { id: shot.id, hint: located }].slice(-BOXES_KEPT) } : {}),
  })
  shotBegan = now
  if (located) frame(boxCentre(located), located.plane, scaleExp)
}

function beginShot(shot: Shot, now: number, id: number): void {
  if (shot.item) { beginSegment(shot, now); return }
  needChain(shot.pubkey, id)
  const s = useTv.getState()
  const opening = shotOpening(shot)
  const scaleExp = fitScale(shot.beats)
  const before = s.shot
  // Straight on from the shot before: the same avatar, picking up where it
  // stopped, at the same zoom. Anything else is a cut, with static.
  const was = s.avatars[shot.pubkey]
  const continues = before !== null && before.pubkey === shot.pubkey && was !== undefined &&
    was.plane === opening.plane && cells(was.position, opening.position, scaleExp) <= 1 && scaleExp === s.scaleExp
  const skipped = before && shot.start > before.end ? shot.start - before.end : 0
  useTv.setState({
    shot,
    played: 0,
    tapeTime: shot.start,
    scaleExp,
    // A shot that follows straight on keeps its camera: a new framing would be a cut.
    framing: continues ? { ...s.framing, from: s.framing.to } : shotFraming(shot.id),
    skipped: continues ? 0 : skipped,
    meanwhile: before !== null && !continues && shot.start < before.end,
    status: 'playing',
    ...(continues ? {} : { cutAt: now }),
    avatars: { ...s.avatars, [shot.pubkey]: { position: opening.position, plane: opening.plane, at: shot.start } },
  })
  shotBegan = now
  frame(opening.position, opening.plane, scaleExp)
}

function tick(id: number): void {
  if (id !== run) return
  const t = tape
  const now = performance.now()
  const s = useTv.getState()
  if (queue.length < QUEUE_LOW) void readMore(id, t)
  if (s.shot === null || (now - shotBegan) / 1000 >= s.shot.length) {
    let next = queue.shift()
    // Arrivals take no screen time: each is a line on the ticker.
    while (next?.kind === 'arrival') { arrive(next); next = queue.shift() }
    if (next) { beginShot(next, now, id); return }
    // The relays stopped answering mid-tape: say so over the last picture
    // rather than holding on it in silence. A read that answers plays on.
    if (failures >= NO_SIGNAL_AFTER && s.status === 'playing') useTv.setState({ status: 'no-signal' })
    if (reader?.caughtUp && readingTape !== t && s.status !== 'end') {
      useTv.setState({ status: 'end', shot: null, cutAt: now })
      // Only if END OF TAPE is still what is on screen: anything played since
      // (a cued item) is not cut off by a retune.
      setTimeout(() => { if (live(id, t) && useTv.getState().status === 'end') void tune(id) }, END_HOLD_MS)
    }
    return
  }
  const elapsed = (now - shotBegan) / 1000
  let played = s.played
  let avatars = s.avatars
  let tapeTime = s.tapeTime
  while (played < s.shot.beats.length && s.shot.offsets[played] <= elapsed) {
    const b = s.shot.beats[played]
    avatars = { ...avatars, [b.pubkey]: { position: b.action.position, plane: b.action.plane, at: b.at } }
    tapeTime = b.at
    played++
  }
  if (played === s.played) return
  useTv.setState({ played, avatars, tapeTime })
  // Keep the subject near the anchor: render space is only exact near it.
  const at = avatars[s.shot.pubkey]
  const cs = useCyberspace.getState()
  if (at && (at.plane !== cs.anchorPlane || cells(at.position, cs.anchor, s.scaleExp) > REANCHOR_CELLS)) frame(at.position, at.plane, s.scaleExp)
}

/** Pick a random event, and play from it: a new tape, nothing of the last one kept. */
async function tune(id: number): Promise<void> {
  if (id !== run) return
  const t = ++tape
  reader = null
  director = new Director()
  queue = []
  retryAt = 0
  failures = 0
  useTv.setState({ status: 'tuning', shot: null, played: 0, tapeTime: null, avatars: {}, arrivals: [], boxes: [], skipped: 0, cutAt: performance.now() })
  let from: number | null = null
  for (let attempt = 0; from === null; attempt++) {
    try {
      from = await randomStart(V2_EPOCH, ask)
      if (from === null) break
    } catch {
      // No relay answered: try again, and say so after a few.
      if (!live(id, t)) return
      if (attempt + 1 >= NO_SIGNAL_AFTER) useTv.setState({ status: 'no-signal' })
      await new Promise((r) => setTimeout(r, Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** attempt)))
      if (!live(id, t)) return
    }
  }
  if (!live(id, t)) return
  if (from === null) { useTv.setState({ status: 'no-signal' }); return }
  useTv.setState({ status: 'tuning' })
  // From a shot's length before the event, so the trip it belongs to is
  // seen from its start rather than joined in the middle.
  reader = new TapeReader(Math.max(V2_EPOCH, from - MAX_SHOT_S), ask)
  void readMore(id, t)
}

/**
 * Where you were before TV took the camera, put back when it ends (review of
 * #370): the view, its anchor and zoom, the cursor, the pin, a place in a
 * chain's history, and whom you were spectating.
 */
interface Before {
  focus: CyberspaceSnapshot['focus']
  anchor: Position
  anchorPlane: CyberspaceSnapshot['anchorPlane']
  cursor: Position
  pin: CyberspaceSnapshot['pin']
  exploreIndex: number | null
  scaleExp: number
  focusReturnScale: CyberspaceSnapshot['focusReturnScale']
  spectating: string | null
}
type CyberspaceSnapshot = ReturnType<typeof useCyberspace.getState>
let before: Before | null = null

/** Why TV will not start now, or null when it can: each of these owns the camera or the screen. */
export function tvBlocked(): string | null {
  const cs = useCyberspace.getState()
  if (cs.walking) return 'WALK'
  if (cs.transit !== null) return 'hyperspace'
  if (useBuilder.getState().active) return 'BUILD'
  if (useShards.getState().pending) return 'deploying'
  if (useDemo.getState().active) return 'the tour'
  return null
}

export const useTv = create<TvState>((set, get) => ({
  on: false,
  status: 'tuning',
  shot: null,
  played: 0,
  tapeTime: null,
  avatars: {},
  cutAt: 0,
  skipped: 0,
  scaleExp: 0,
  framing: shotFraming(''),
  meanwhile: false,
  arrivals: [],
  census: null,
  chains: {},
  boxes: [],

  start: () => {
    if (get().on) return true
    if (tvBlocked() !== null) return false
    const cs = useCyberspace.getState()
    before = {
      focus: cs.focus, anchor: { ...cs.anchor }, anchorPlane: cs.anchorPlane, cursor: { ...cs.cursor }, pin: cs.pin,
      exploreIndex: cs.exploreIndex, scaleExp: cs.scaleExp, focusReturnScale: cs.focusReturnScale,
      spectating: cs.spectate?.pubkey ?? null,
    }
    if (cs.spectate) stopSpectating()
    run++
    set({ on: true })
    const id = run
    timer = setInterval(() => tick(id), TICK_MS) as unknown as number
    void tune(id)
    if (!get().census) loadCensus(ask).then((census) => { if (id === run) set({ census }) }, () => {})
    return true
  },

  retune: () => {
    if (get().on) void tune(run)
  },

  stop: () => {
    if (!get().on) return
    run++
    tape++
    if (timer !== null) clearInterval(timer)
    timer = null
    reader = null
    director = null
    queue = []
    asked.clear()
    set({ on: false, shot: null, played: 0, tapeTime: null, avatars: {}, arrivals: [], chains: {}, boxes: [], status: 'tuning' })
    // A tap on an avatar during TV is not a request for its card afterwards.
    usePersonCard.getState().close()
    const cs = useCyberspace.getState()
    const was = before
    before = null
    const tvFocus = cs.focus?.label === TV_FOCUS_LABEL
    if (was && (was.focus !== null || was.exploreIndex !== null) && !was.spectating) {
      // A view or a place in history: put back whole, in one write. Ending
      // TV's view first (clearFocus) left the focus empty for a moment, and
      // a view's own watchers took that for RETURN: the Nearby list popped
      // open and lost its way back (review of #370, round 2).
      if (tvFocus) {
        useCyberspace.setState({
          focus: was.focus, anchor: was.anchor, anchorPlane: was.anchorPlane, exploreIndex: was.exploreIndex,
          pin: was.pin, cursor: was.cursor, scaleExp: was.scaleExp, focusReturnScale: was.focusReturnScale,
        })
      }
    } else {
      // At your head (or spectating): the anchor is wherever your head is
      // now, which clearFocus works out.
      // Only while TV's own view is still up: a view that ended TV (Back onto
      // the tour, say) keeps the zoom and the cursor it chose (review of
      // #370, round 3).
      if (tvFocus) cs.clearFocus()
      if (was && tvFocus) {
        useCyberspace.setState({ pin: was.pin, cursor: was.cursor, scaleExp: was.scaleExp, focusReturnScale: was.focusReturnScale })
        if (was.spectating) void spectate(was.spectating)
      }
    }
    try {
      if (isTvPath(window.location.pathname)) {
        if ((window.history.state as Record<string, unknown> | null)?.[PUSHED]) window.history.back()
        else window.history.replaceState(null, '', '/')
      }
    } catch { /* no history here */ }
  },
}))

/** TV from a button: on a new history entry of its own, so Back leaves it. */
export function startTvInPlace(): void {
  // A /C/ link's view ends first, as the tour's start does (useDemo
  // startTourInPlace): its ending puts / in place of its own address, which
  // after the push would be TV's entry.
  if (useCoordRoute.getState().label !== null && useCyberspace.getState().focus) useCyberspace.getState().clearFocus(true)
  if (!useTv.getState().start()) return
  try { window.history.pushState({ [PUSHED]: 1 }, '', TV_PATH) } catch { /* no history here */ }
}

/** Whether an address is TV's. */
export function isTvPath(pathname: string): boolean {
  return /^\/tv\/?$/i.test(pathname)
}

// Any other view taking over (a VIEW, a spectation, a /C/ link) ends TV:
// the camera is no longer TV's to point.
useCyberspace.subscribe((st, prev) => {
  if (!useTv.getState().on || st.focus === prev.focus) return
  if (st.focus?.label !== TV_FOCUS_LABEL) useTv.getState().stop()
})
