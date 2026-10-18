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
import { Director, JUMP_LINE_S, JUMP_S, JUMP_WARP_S, MAX_SHOT_S, isJump, shotFraming, type Beat, type Framing, type Shot, type TapeItem } from '../lib/tv/director'
import type { HintBox } from '../lib/hint'
import { TapeReader, V2_EPOCH, randomStart, type Ask, TapeUnanswered } from '../lib/tv/tape'
import { loadCensus, loadChainTimes, type Census, type ChainTimes } from '../lib/tv/stats'
import { MAX_SCALE_EXP, type Position } from '../lib/space'
import { coordToXyz } from 'cyberspace-core'
import { stopCoordExact } from '../lib/hyperspace/stops'
import { getStopByHeight } from './useHyperspace'
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
  /** Where it came from, on its last move: what it faces along (TvLayer). */
  from?: Position
  /**
   * When it spawned on screen (performance.now()), so it grows from a point
   * (TvLayer); Infinity while a shot opening with its spawn waits to play it.
   */
  born?: number
  /**
   * Where it has been on tape, oldest first, ending where it is: the trail
   * drawn behind it while the Chain trail switch is on (scene/TvTrail). Only
   * what TV played, in one plane: a cut starts a new one, so no line is drawn
   * across history the tape skipped.
   */
  path?: Position[]
}

export type TvStatus = 'tuning' | 'playing' | 'end' | 'no-signal'

/** One end of a hyperjump's ride: a block, and where it is. */
export interface RideEnd {
  position: Position
  plane: number
  height: number
  /** Whether `position` is the block's own: false for A before the stop index has it, which is where the rider stood instead. */
  exact: boolean
}

/**
 * A hyperjump's ride on screen, before its shot's first beat: the tunnel
 * (warp), then the line from block A to block B with only those two drawn
 * (line; scene/TvJump).
 */
export interface TvJump {
  phase: 'warp' | 'line'
  from: RideEnd
  to: RideEnd
}

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
  /** The newest reactions on tape to shards and moves, newest last, for the ticker. */
  reactions: Array<{ pubkey: string; at: number; content: string; on: 'shard' | 'move' }>
  /** The ticker's counts (lib/tv/stats.ts), once read. */
  census: Census | null
  /** Each on-screen avatar's chain, for its length at tape time. */
  chains: Record<string, ChainTimes>
  /** The hint boxes of the bags the tape has shown, whose outlines stay in the world (TvLayer). */
  boxes: Array<{ id: string; hint: HintBox }>
  /** The hyperjump being ridden on screen, or null. */
  jump: TvJump | null
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

/** How many places an avatar's trail keeps; the oldest go first. */
const TRAIL_KEPT = 256

/** An avatar's path after it steps to `position`: on from where it was in the same plane, else starting there. */
export function pathAfter(was: TvAvatar | undefined, position: Position, plane: number): Position[] {
  if (!was?.path?.length || was.plane !== plane) return [position]
  const last = was.path[was.path.length - 1]
  if (last.x === position.x && last.y === position.y && last.z === position.z) return was.path
  return [...was.path, position].slice(-TRAIL_KEPT)
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

/** How long one question may take before it counts as unanswered. */
export const READ_STUCK_MS = 25_000

/**
 * Every question the tape asks, with a deadline: one that never comes back
 * (a socket that died while the app was in the background, a sign-in
 * waiting on a signer app that never answers) used to hold the tape still
 * for good (arkinox, 2026-10-18: "i did get the tv to get stuck when i
 * switched away from the pwa to another android app and then back"). Past
 * READ_STUCK_MS it is taken as no relay answering, which is asked again,
 * never skipped; whatever it brings back late is dropped.
 */
function askWithin(f: Parameters<Ask>[0]): ReturnType<Ask> {
  return new Promise((resolve, reject) => {
    const late = setTimeout(() => reject(new TapeUnanswered()), READ_STUCK_MS)
    ask(f).then((a) => { clearTimeout(late); resolve(a) }, (e) => { clearTimeout(late); reject(e) })
  })
}
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

/** Seconds since the shot on screen began. */
export function shotElapsed(): number {
  return (performance.now() - shotBegan) / 1000
}

/**
 * How far through its framing the camera is, 0 to 1, for the push-in: the
 * shot's, or, in a hyperjump's ride, the phase's (the tunnel, the line, then
 * what is left of the shot after it).
 */
export function framingProgress(): number {
  const s = useTv.getState()
  if (!s.shot) return 0
  const prelude = s.shot.prelude ?? 0
  const [from, length] = s.jump?.phase === 'warp' ? [0, JUMP_WARP_S] : s.jump ? [JUMP_WARP_S, JUMP_LINE_S] : [prelude, s.shot.length - prelude]
  return Math.min(1, Math.max(0, (shotElapsed() - from) / length))
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

/** Play a run of beats next as the director would cut them, for the smoke probe: a hyperjump, say. */
export function cueBeats(beats: Beat[]): void {
  const d = new Director()
  for (const b of beats) d.add(b)
  queue.unshift(...d.release(Infinity))
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
  const current = (): boolean => live(id, t) && r === reader
  try {
    while (current() && queue.length < QUEUE_LOW && !r.caughtUp) {
      const { beats, items } = await r.read()
      if (!current()) return
      failures = 0
      for (const b of beats) d.add(b)
      for (const item of items) d.addItem(item)
      queue.push(...d.release(r.readTo - 1))
    }
    if (current() && r.caughtUp) queue.push(...d.release(Infinity))
  } catch {
    // No relay answered: the same window is asked again, later. It is never
    // taken for an empty stretch of history.
    if (!current()) return
    failures++
    retryAt = performance.now() + Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** (failures - 1))
    if (failures >= NO_SIGNAL_AFTER && queue.length === 0 && useTv.getState().shot === null) useTv.setState({ status: 'no-signal' })
    // A shot still on screen says NO SIGNAL from tick, once it has played out.
  } finally {
    if (readingTape === t && r === reader) readingTape = -1
  }
}

// Back from the background: the shot picks up where it was, not as far on
// as the time away, and the reader may ask again at once.
let hidden: { shot: Shot | null; elapsed: number } | null = null
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hidden = { shot: useTv.getState().shot, elapsed: performance.now() - shotBegan }
      return
    }
    const was = hidden
    hidden = null
    if (!was || !useTv.getState().on) return
    // Only the shot that was on screen: one the throttled timer began while
    // away keeps its own start.
    if (was.shot !== null && useTv.getState().shot === was.shot) shotBegan = performance.now() - was.elapsed
    retryAt = 0
  })
}

function frame(position: Position, plane: number, scaleExp: number): void {
  useCyberspace.getState().focusOn(position, plane as 0 | 1, TV_FOCUS_LABEL, scaleExp)
}

function arrive(shot: Shot): void {
  const s = useTv.getState()
  const b = shot.beats[0]
  useTv.setState({
    arrivals: [...s.arrivals, { pubkey: b.pubkey, at: b.at }].slice(-ARRIVALS_KEPT),
    avatars: { ...s.avatars, [b.pubkey]: { position: b.action.position, plane: b.action.plane, at: b.at, born: performance.now(), path: [b.action.position] } },
  })
}

function react(shot: Shot): void {
  const r = shot.item
  if (r?.kind !== 'reaction') return
  const s = useTv.getState()
  useTv.setState({ reactions: [...s.reactions, { pubkey: r.pubkey, at: r.at, content: r.content, on: r.on }].slice(-ARRIVALS_KEPT) })
}

/** The avatars whose chain has been asked for, this session. */
const asked = new Set<string>()

function needChain(pubkey: string, id: number): void {
  if (useTv.getState().chains[pubkey] || asked.has(pubkey)) return
  asked.add(pubkey)
  loadChainTimes(pubkey, askWithin).then((c) => {
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

/** The tunnel's camera: close beside the rider, the streaks all round it. */
const WARP_FRAMING: Framing = { from: 7, to: 5, polar: 1.25, name: 'close', view: 'side', sun: false, spin: 1 }
/** The line's camera: over the two blocks, pulling back as the rider goes ("zoom out"). */
const LINE_FRAMING: Framing = { from: 16, to: 26, polar: 0.75, name: 'wide', view: 'above', sun: false, spin: 1 }

/**
 * A hyperjump's two blocks. B is where it landed, from its own `C`, always
 * exact. A is its `from_height` block: B itself on a ride to the block it
 * left (review of #379); else exact from the stop index once that height is
 * loaded; before then, where the rider stood (`c`), which on a chained ride
 * is A's coordinate itself and on a first ride the spot it boarded from.
 * Which of the two cannot be told from the event: `as_of` should mark a
 * first ride, but older clients put it on every ride (18 of the 19 on the
 * relay carry it), so a `c` is never named as block A.
 */
export function rideEnds(b: Beat): { from: RideEnd; to: RideEnd } {
  const a = b.action
  const to: RideEnd = { position: a.position, plane: a.plane, height: a.toHeight ?? 0, exact: true }
  if (a.fromHeight === a.toHeight) return { from: to, to }
  const stop = a.fromHeight !== undefined ? getStopByHeight(a.fromHeight) : undefined
  const at = stop ? coordToXyz(stopCoordExact(stop)) : null
  const from: RideEnd = at
    ? { position: { x: at.x, y: at.y, z: at.z }, plane: at.plane, height: a.fromHeight ?? 0, exact: true }
    : { position: b.from.position, plane: b.from.plane, height: a.fromHeight ?? 0, exact: false }
  return { from, to }
}

/** The zoom that holds both blocks within FIT_CELLS, and the point halfway between them. */
export function rideView(from: Position, to: Position): { centre: Position; scaleExp: number } {
  const span = (u: bigint, v: bigint): bigint => (u > v ? u - v : v - u)
  const extent = [span(from.x, to.x), span(from.y, to.y), span(from.z, to.z)].reduce((p, q) => (q > p ? q : p))
  let exp = 0
  while ((extent >> BigInt(exp)) > BigInt(FIT_CELLS) && exp < MAX_SCALE_EXP) exp++
  return { centre: { x: (from.x + to.x) / 2n, y: (from.y + to.y) / 2n, z: (from.z + to.z) / 2n }, scaleExp: exp }
}

/** The tunnel is over: cut to the two blocks and the line between them. */
function lineUp(jump: TvJump, now: number): void {
  const { centre, scaleExp } = rideView(jump.from.position, jump.to.position)
  useTv.setState({ jump: { ...jump, phase: 'line' }, scaleExp, framing: LINE_FRAMING, cutAt: now })
  frame(centre, jump.to.plane, scaleExp)
}

/**
 * When an avatar was born, for a shot that does not open with its spawn: as
 * it was, except a spawn that never played (its shot cut short before it, by
 * a cue) leaves it whole rather than held at nothing for good.
 */
function bornAfter(was: TvAvatar | undefined): number | undefined {
  return was?.born === Infinity ? undefined : was?.born
}

/** The ride is over: cut to the rider at B, for the rest of the shot. */
function land(shot: Shot, now: number): void {
  const s = useTv.getState()
  const opening = shotOpening(shot)
  const scaleExp = fitScale(shot.beats)
  const was = s.avatars[shot.pubkey]
  useTv.setState({
    jump: null,
    scaleExp,
    framing: shotFraming(shot.id),
    cutAt: now,
    avatars: { ...s.avatars, [shot.pubkey]: { position: opening.position, plane: opening.plane, at: shot.start, from: was && was.plane === opening.plane ? was.position : undefined, born: bornAfter(was), path: [opening.position] } },
  })
  frame(opening.position, opening.plane, scaleExp)
}

/** How many bag outlines stay in the world at once; the oldest go first. */
const BOXES_KEPT = 12
/** A located bag's box is framed this many powers of two under its own size: about 8 cells across. */
const BOX_FIT = 3

/**
 * Whether a hint box can be shown in the world: one box too uneven to frame
 * (a side more than 2^5 times another) plays in the inset instead, as a bag
 * with no hint does (review of #371).
 */
export function placeable(hint: HintBox | null): hint is HintBox {
  if (!hint) return false
  return Math.max(...hint.heights) - Math.min(...hint.heights) <= 5
}

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
  const located = item?.kind === 'bag' && placeable(item.hint) ? item.hint : null
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
    jump: null,
    ...(located ? { framing: { from: 26, to: 18, polar: 0.6, name: 'wide' as const, view: 'above' as const, sun: false, spin: 1 as const }, boxes: [...s.boxes.filter((b) => b.id !== shot.id), { id: shot.id, hint: located }].slice(-BOXES_KEPT) } : {}),
  })
  shotBegan = now
  if (located) frame(boxCentre(located), located.plane, scaleExp)
}

function beginShot(shot: Shot, now: number, id: number): void {
  if (shot.item) { beginSegment(shot, now); return }
  needChain(shot.pubkey, id)
  const s = useTv.getState()
  // A hyperjump's ride opens where the rider stood, in the tunnel (tick plays the rest).
  const ride = shot.prelude ? rideEnds(shot.beats[0]) : null
  const opening = ride ? shot.beats[0].from : shotOpening(shot)
  const scaleExp = fitScale(shot.beats)
  const before = s.shot
  // Straight on from the shot before: the same avatar, picking up where it
  // stopped, at the same zoom. Anything else is a cut, with static.
  const was = s.avatars[shot.pubkey]
  // Only after a trip: a segment's author is not where its camera was (review of #371).
  const continues = ride === null && before !== null && before.kind === 'trip' && before.pubkey === shot.pubkey && was !== undefined &&
    was.plane === opening.plane && cells(was.position, opening.position, scaleExp) <= 1 && scaleExp === s.scaleExp
  const skipped = before && shot.start > before.end ? shot.start - before.end : 0
  useTv.setState({
    shot,
    played: 0,
    tapeTime: shot.start,
    scaleExp,
    // A shot that follows straight on keeps its camera: a new framing would be a cut.
    framing: ride ? WARP_FRAMING : continues ? { ...s.framing, from: s.framing.to } : shotFraming(shot.id),
    jump: ride ? { phase: 'warp', ...ride } : null,
    skipped: continues ? 0 : skipped,
    meanwhile: before !== null && !continues && shot.start < before.end,
    status: 'playing',
    ...(continues ? {} : { cutAt: now }),
    // Facing kept across the cut: from where it was last seen, or as it was.
    avatars: { ...s.avatars, [shot.pubkey]: { born: shot.beats[0]?.action.type === 'spawn' ? Infinity : bornAfter(was), position: opening.position, plane: opening.plane, at: shot.start, from: was && was.plane === opening.plane && (was.position.x !== opening.position.x || was.position.y !== opening.position.y || was.position.z !== opening.position.z) ? was.position : was?.from, path: continues ? pathAfter(was, opening.position, opening.plane) : [opening.position] } },
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
    // Arrivals and reactions take no screen time: each is a line on the ticker.
    while (next?.kind === 'arrival' || next?.kind === 'reaction') { if (next.kind === 'arrival') arrive(next); else react(next); next = queue.shift() }
    if (next) { beginShot(next, now, id); return }
    // The relays stopped answering mid-tape: say so over the last picture
    // rather than holding on it in silence. A read that answers plays on.
    if (failures >= NO_SIGNAL_AFTER && s.status === 'playing') useTv.setState({ status: 'no-signal' })
    if (reader?.caughtUp && readingTape !== t && s.status !== 'end') {
      useTv.setState({ status: 'end', shot: null, jump: null, cutAt: now })
      // Only if END OF TAPE is still what is on screen: anything played since
      // (a cued item) is not cut off by a retune.
      setTimeout(() => { if (live(id, t) && useTv.getState().status === 'end') void tune(id) }, END_HOLD_MS)
    }
    return
  }
  const elapsed = (now - shotBegan) / 1000
  // A hyperjump's ride: the tunnel, the line, then the rider at B. No beat
  // plays during it (the director put them all after it).
  if (s.jump) {
    if (s.jump.phase === 'warp' && elapsed >= JUMP_WARP_S) lineUp(s.jump, now)
    else if (s.jump.phase === 'line' && elapsed >= JUMP_S) land(s.shot, now)
    return
  }
  let played = s.played
  let avatars = s.avatars
  let tapeTime = s.tapeTime
  while (played < s.shot.beats.length && s.shot.offsets[played] <= elapsed) {
    const b = s.shot.beats[played]
    const was = avatars[b.pubkey]
    const spawned = b.action.type === 'spawn'
    avatars = { ...avatars, [b.pubkey]: { position: b.action.position, plane: b.action.plane, at: b.at, from: !spawned && was && was.plane === b.action.plane ? was.position : undefined, born: spawned ? performance.now() : was?.born, path: spawned ? [b.action.position] : pathAfter(was, b.action.position, b.action.plane) } }
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
  useTv.setState({ status: 'tuning', shot: null, played: 0, tapeTime: null, avatars: {}, arrivals: [], reactions: [], boxes: [], jump: null, skipped: 0, cutAt: performance.now() })
  let from: number | null = null
  for (let attempt = 0; from === null; attempt++) {
    try {
      from = await randomStart(V2_EPOCH, askWithin)
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
  reader = new TapeReader(Math.max(V2_EPOCH, from - MAX_SHOT_S), askWithin)
  // The numbers, again, if they did not come the first time.
  if (!useTv.getState().census) loadCensus(askWithin).then((census) => { if (live(id, t)) useTv.setState({ census }) }, () => {})
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
  reactions: [],
  census: null,
  chains: {},
  boxes: [],
  jump: null,

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
    if (!get().census) loadCensus(askWithin).then((census) => { if (id === run) set({ census }) }, () => {})
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
    set({ on: false, shot: null, played: 0, tapeTime: null, avatars: {}, arrivals: [], reactions: [], chains: {}, boxes: [], jump: null, status: 'tuning' })
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
      // Not over a view that ended TV (Back onto the tour, say): it keeps the
      // zoom and the cursor it chose (review of #370, round 3). Before TV's
      // first shot nothing has taken the view, so a spectation is resumed
      // then too (round 4).
      if (tvFocus) cs.clearFocus()
      if (was && (tvFocus || cs.focus === null)) {
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
