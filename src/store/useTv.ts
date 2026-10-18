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
import { query } from '../lib/relay'
import { Director, MAX_SHOT_S, shotFraming, type Beat, type Framing, type Shot } from '../lib/tv/director'
import { TapeReader, V2_EPOCH, randomStart, type Ask } from '../lib/tv/tape'
import { loadCensus, loadChainTimes, type Census, type ChainTimes } from '../lib/tv/stats'
import { MAX_SCALE_EXP, type Position } from '../lib/space'
import { useCyberspace } from './useCyberspace'
import { stopSpectating } from '../lib/spectator'

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
  start: () => void
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

/** The zoom that shows every place in `beats` (and where they started) within FIT_CELLS. */
export function fitScale(beats: Beat[]): number {
  let extent = 0n
  for (const axis of ['x', 'y', 'z'] as const) {
    let lo: bigint | null = null
    let hi: bigint | null = null
    for (const b of beats) {
      for (const v of [b.from.position[axis], b.action.position[axis]]) {
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

// The engine: one tape at a time.
let run = 0
let reader: TapeReader | null = null
let director: Director | null = null
let queue: Shot[] = []
let reading = false
let shotBegan = 0
let timer: number | null = null
let ask: Ask = query

/** How far through the shot on screen the tape is, 0 to 1. */
export function shotProgress(): number {
  const shot = useTv.getState().shot
  if (!shot) return 0
  return Math.min(1, Math.max(0, (performance.now() - shotBegan) / 1000 / shot.length))
}

/** Swap the relay read, for tests. */
export function setTvAsk(fn: Ask): void { ask = fn }

async function readMore(id: number): Promise<void> {
  if (reading || !reader || !director) return
  reading = true
  try {
    while (id === run && queue.length < QUEUE_LOW && !reader.caughtUp) {
      const beats = await reader.next()
      if (id !== run) return
      for (const b of beats) director.add(b)
      queue.push(...director.release(reader.readTo - 1))
    }
    if (id === run && reader.caughtUp) queue.push(...director.release(Infinity))
  } catch {
    if (id === run && queue.length === 0) useTv.setState({ status: 'no-signal' })
  } finally {
    reading = false
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

function beginShot(shot: Shot, now: number, id: number): void {
  needChain(shot.pubkey, id)
  const s = useTv.getState()
  const first = shot.beats[0]
  const scaleExp = fitScale(shot.beats)
  const before = s.shot
  // Straight on from the shot before: the same avatar, picking up where it
  // stopped, at the same zoom. Anything else is a cut, with static.
  const was = s.avatars[shot.pubkey]
  const continues = before !== null && before.pubkey === shot.pubkey && was !== undefined &&
    was.plane === first.from.plane && cells(was.position, first.from.position, scaleExp) <= 1 && scaleExp === s.scaleExp
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
    avatars: { ...s.avatars, [shot.pubkey]: { position: first.from.position, plane: first.from.plane, at: shot.start } },
  })
  shotBegan = now
  frame(first.from.position, first.from.plane, scaleExp)
}

function tick(id: number): void {
  if (id !== run) return
  const now = performance.now()
  const s = useTv.getState()
  if (queue.length < QUEUE_LOW) void readMore(id)
  if (s.shot === null || (now - shotBegan) / 1000 >= s.shot.length) {
    let next = queue.shift()
    // Arrivals take no screen time: each is a line on the ticker.
    while (next?.kind === 'arrival') { arrive(next); next = queue.shift() }
    if (next) { beginShot(next, now, id); return }
    if (reader?.caughtUp && !reading) {
      if (s.status !== 'end') { useTv.setState({ status: 'end', shot: null, cutAt: now }); setTimeout(() => { if (id === run) void tune(id) }, END_HOLD_MS) }
    }
    return
  }
  const t = (now - shotBegan) / 1000
  let played = s.played
  let avatars = s.avatars
  let tapeTime = s.tapeTime
  while (played < s.shot.beats.length && s.shot.offsets[played] <= t) {
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

/** Pick a random event, and play from it. */
async function tune(id: number): Promise<void> {
  if (id !== run) return
  useTv.setState({ status: 'tuning', shot: null, played: 0, tapeTime: null, avatars: {}, arrivals: [], skipped: 0, cutAt: performance.now() })
  queue = []
  director = new Director()
  let from: number | null = null
  try {
    from = await randomStart(V2_EPOCH, ask)
  } catch { from = null }
  if (id !== run) return
  if (from === null) { useTv.setState({ status: 'no-signal' }); return }
  // From a shot's length before the event, so the trip it belongs to is
  // seen from its start rather than joined in the middle.
  reader = new TapeReader(Math.max(V2_EPOCH, from - MAX_SHOT_S), ask)
  void readMore(id)
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

  start: () => {
    if (get().on) return
    const cs = useCyberspace.getState()
    if (cs.walking) return
    if (cs.spectate) stopSpectating()
    run++
    set({ on: true })
    const id = run
    timer = setInterval(() => tick(id), TICK_MS) as unknown as number
    void tune(id)
    if (!get().census) loadCensus(ask).then((census) => { if (id === run) set({ census }) }, () => {})
  },

  stop: () => {
    if (!get().on) return
    run++
    if (timer !== null) clearInterval(timer)
    timer = null
    reader = null
    director = null
    queue = []
    asked.clear()
    set({ on: false, shot: null, played: 0, tapeTime: null, avatars: {}, arrivals: [], chains: {}, status: 'tuning' })
    if (useCyberspace.getState().focus?.label === TV_FOCUS_LABEL) useCyberspace.getState().clearFocus()
    try {
      if (window.location.pathname.toLowerCase() === TV_PATH) {
        if ((window.history.state as Record<string, unknown> | null)?.[PUSHED]) window.history.back()
        else window.history.replaceState(null, '', '/')
      }
    } catch { /* no history here */ }
  },
}))

/** TV from a button: on a new history entry of its own, so Back leaves it. */
export function startTvInPlace(): void {
  try { window.history.pushState({ [PUSHED]: 1 }, '', TV_PATH) } catch { /* no history here */ }
  useTv.getState().start()
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
