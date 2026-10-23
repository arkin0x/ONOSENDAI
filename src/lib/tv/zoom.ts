/**
 * zoom.ts: the zoom a Cyberspace TV trip plays at, from moment to moment.
 *
 * A trip used to play at one zoom, the one that fits its whole path. A run
 * of one-cell nudges followed by one long hop then played at the hop's zoom
 * from the first frame, where the nudges are far under a cell: the avatar
 * only turned on the spot (arkinox, 2026-10-23: "XOR's avatar just changes
 * direction a bunch of times but doesnt go anywhere because the initial moves
 * are too small to see at 2^17. Would we be able to zoom out to 2^17 when the
 * actual larger move is coming up?").
 *
 * So the zoom follows the moves. Each move asks for the zoom that fits it
 * within FIT_CELLS, as a one-move trip always was. The trip is cut into
 * spans of moves that share a zoom: a move that needs a wider zoom starts a
 * new span, and so does a move ZOOM_IN_STEPS or more powers of two finer
 * than the span's. A span with wider zooms on both sides (a dip: in, then
 * straight back out) shorter than MIN_HOLD_S or with fewer than
 * MIN_HOLD_BEATS moves is not worth zooming in for and plays at the nearer
 * of the two, so a trip that alternates small and large moves holds the
 * wide zoom instead of pumping in and out. A span at either end of the trip
 * with a wider neighbour is kept only for MIN_HOLD_BEATS moves or more. A
 * step on the way out or in (finer on one side, wider on the other) keeps
 * its zoom: it is no pump. A large move always gets the zoom it needs: a
 * move wider than the frame would fly out of it.
 *
 * Between spans the zoom changes one power of two at a time, ZOOM_STEP_S
 * apart (at most ZOOM_MAX_S in all), as the zoom buttons step it. Out: it
 * looks ahead and is done ZOOM_SETTLE_S before the large move starts, so the
 * move plays whole at its own zoom. In: it waits WIDE_HOLD_S after the last
 * wider move starts (its glide, AVATAR_LERP_MS, landed and the camera
 * caught up) and after the wide zoom was reached, then steps in on the
 * small ones; and it never runs into the next zoom out, which is never late.
 *
 * A one-move trip plays at the zoom it always did (its move is its whole
 * path), and no trip ever plays wider than its whole path's zoom. Screen
 * time is not changed: the zoom rides on the director's offsets
 * (director.ts).
 *
 * Pure: the store (store/useTv.ts) asks it for a shot's plan when the shot
 * begins and plays the plan against the shot's clock.
 */

import { AVATAR_LERP_MS } from '../avatarLerp'
import { MAX_SCALE_EXP, type Position } from '../space'
import { isJump, type Beat } from './director'

/** A shot is framed so its whole path fits in about this many cells across; a move, so it fits in this many. */
export const FIT_CELLS = 12
/** A move this many powers of two finer than the zoom it plays at, or more, is worth zooming in for. */
export const ZOOM_IN_STEPS = 2
/** A finer zoom is held at least this long, seconds of screen time, or not taken. */
export const MIN_HOLD_S = 4
/** A finer zoom is taken for at least this many moves, or not taken. */
export const MIN_HOLD_BEATS = 2
/** Screen time per power of two the zoom steps. */
export const ZOOM_STEP_S = 0.1
/** The longest a change of zoom takes, however many powers of two it covers. */
export const ZOOM_MAX_S = 1.5
/**
 * A wider zoom is held at least this long, seconds, before the zoom steps
 * back in: after it was reached, and after the last move that needed it
 * started (its glide, and the camera following it, settled). At least GLIDE_S.
 */
export const WIDE_HOLD_S = 1.5
/** How long before a large move a zoom out is finished, so the move starts at its zoom. */
export const ZOOM_SETTLE_S = 0.15
/** A zoom in waits this long after the move before it, for that move's glide to land. */
export const GLIDE_S = AVATAR_LERP_MS / 1000 + 0.05

/** From `at` seconds into the shot, the zoom is 2^`scaleExp`. */
export interface ZoomStep {
  at: number
  scaleExp: number
}

/** The zoom that holds a span of `extent` gibsons within FIT_CELLS. */
function extentScale(extent: bigint): number {
  let exp = 0
  while ((extent >> BigInt(exp)) > BigInt(FIT_CELLS) && exp < MAX_SCALE_EXP) exp++
  return exp
}

function span(a: Position, b: Position): bigint {
  const d = (u: bigint, v: bigint): bigint => (u > v ? u - v : v - u)
  return [d(a.x, b.x), d(a.y, b.y), d(a.z, b.z)].reduce((p, q) => (q > p ? q : p))
}

/**
 * The zoom that shows every place in `beats` (and where they started) within
 * FIT_CELLS. A first beat that is a jump is a cut (useTv shotOpening): where
 * it jumped from is not in the shot, and fitting it in framed three
 * one-gibson hops after a hyperjump at 2^59 (review of #370).
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
  return extentScale(extent)
}

/** The zoom one beat's move asks for; null for an opening jump, which is a cut onto where it lands, not a move. */
export function moveScale(b: Beat, first: boolean): number | null {
  if (first && isJump(b)) return null
  return extentScale(span(b.from.position, b.action.position))
}

/** A run of beats [first, last] played at one zoom. */
interface Span {
  first: number
  last: number
  scaleExp: number
}

/**
 * When the zoom changes over a trip: the zoom at 0 and each power-of-two
 * step after it, in order. `offsets` are the shot's (director beatOffsets,
 * a hyperjump's ride included); `prelude` is the ride's length, before which
 * nothing changes (the ride has its own camera); `length` is the shot's.
 */
export function zoomPlan(beats: Beat[], offsets: number[], length: number, prelude = 0): ZoomStep[] {
  if (beats.length === 0) return []
  const whole = fitScale(beats)
  const needs = beats.map((b, i) => moveScale(b, i === 0))
  // Spans, greedily: wider than the span starts a new one; much finer does too.
  let spans: Span[] = []
  for (let i = 0; i < beats.length; i++) {
    const need = needs[i]
    const cur = spans[spans.length - 1]
    if (need === null) { if (cur) cur.last = i; else spans.push({ first: i, last: i, scaleExp: -1 }); continue }
    if (!cur) { spans.push({ first: i, last: i, scaleExp: need }); continue }
    if (cur.scaleExp < 0) { cur.scaleExp = need; cur.last = i; continue }
    if (need > cur.scaleExp || need <= cur.scaleExp - ZOOM_IN_STEPS) spans.push({ first: i, last: i, scaleExp: need })
    else cur.last = i
  }
  // A shot of nothing but an opening jump has nothing to fit but where it lands.
  for (const s of spans) if (s.scaleExp < 0) s.scaleExp = whole
  const startOf = (k: number): number => offsets[spans[k].first]
  const endOf = (k: number): number => (k + 1 < spans.length ? offsets[spans[k + 1].first] : length)
  // Too short to zoom in for: played at the nearer wider neighbour's zoom.
  // One at a time, the finest first (then the shortest), until none is left:
  // a lone nudge joins the run beside it before that run is judged.
  const tooShort = (k: number): boolean => {
    const prev = spans[k - 1]
    const next = spans[k + 1]
    const beatsIn = spans[k].last - spans[k].first + 1
    const widerBefore = prev !== undefined && prev.scaleExp > spans[k].scaleExp
    const widerAfter = next !== undefined && next.scaleExp > spans[k].scaleExp
    // A dip: in and straight back out.
    if (widerBefore && widerAfter) return endOf(k) - startOf(k) < MIN_HOLD_S || beatsIn < MIN_HOLD_BEATS
    // The trip's first or last span, in from or out to a wider zoom.
    if ((widerBefore && next === undefined) || (widerAfter && prev === undefined)) return beatsIn < MIN_HOLD_BEATS
    // A step on the way out or in, or the only span.
    return false
  }
  for (;;) {
    let pick = -1
    let pickLen = Infinity
    for (let k = 0; k < spans.length; k++) {
      const len = endOf(k) - startOf(k)
      if (!tooShort(k)) continue
      if (pick < 0 || spans[k].scaleExp < spans[pick].scaleExp || (spans[k].scaleExp === spans[pick].scaleExp && len < pickLen)) { pick = k; pickLen = len }
    }
    if (pick < 0) break
    const prev = spans[pick - 1]
    const next = spans[pick + 1]
    const into = [prev, next].filter((n): n is Span => n !== undefined && n.scaleExp > spans[pick].scaleExp)
      .reduce((a, b) => (b.scaleExp < a.scaleExp ? b : a))
    spans[pick].scaleExp = into.scaleExp
    spans = merged(spans)
  }
  spans = merged(spans)
  // The steps, span by span.
  const zoomOf = (k: number): number => Math.min(whole, spans[k].scaleExp)
  const takes = (n: number): number => Math.min(ZOOM_MAX_S, n * ZOOM_STEP_S)
  const plan: ZoomStep[] = [{ at: 0, scaleExp: zoomOf(0) }]
  let from = zoomOf(0)
  // When the last change ended (nothing changes during a hyperjump's ride), and when the zoom on screen was reached.
  let free = prelude
  let reached = prelude
  for (let k = 1; k < spans.length; k++) {
    const to = zoomOf(k)
    if (to === from) continue
    const n = Math.abs(to - from)
    const take = takes(n)
    const move = offsets[spans[k].first]
    let start: number
    let end: number
    if (to > from) {
      // Out, ahead of the large move: done ZOOM_SETTLE_S before it, never after it starts.
      end = Math.max(free, move - ZOOM_SETTLE_S)
      start = Math.max(free, end - take)
      if (end > move) end = start = Math.max(free, move)
    } else {
      // In, once the last wider move has landed and the camera caught up
      // with it, and the wider zoom has been seen for WIDE_HOLD_S, so one
      // larger move is not a breath out and in. Never sooner than its glide.
      const wideMove = offsets[spans[k].first - 1]
      const landed = Math.max(free, wideMove + GLIDE_S)
      start = Math.max(landed, wideMove + WIDE_HOLD_S, reached + WIDE_HOLD_S)
      end = start + take
      // And done in time for the zoom out before the next large move, which is never late.
      const next = k + 1 < spans.length && zoomOf(k + 1) > to ? k + 1 : -1
      if (next >= 0) {
        const latest = offsets[spans[next].first] - ZOOM_SETTLE_S - takes(zoomOf(next) - to)
        if (latest < landed) continue
        if (end > latest) { start = Math.max(landed, latest - take); end = Math.min(start + take, latest) }
      }
    }
    for (let j = 1; j <= n; j++) plan.push({ at: start + ((end - start) * j) / n, scaleExp: from + (to > from ? j : -j) })
    free = end
    reached = end
    from = to
  }
  return plan
}

/** Spans next to each other at the same zoom, as one. */
function merged(spans: Span[]): Span[] {
  const out: Span[] = []
  for (const s of spans) {
    const last = out[out.length - 1]
    if (last && last.scaleExp === s.scaleExp) last.last = s.last
    else out.push({ ...s })
  }
  return out
}

/** The zoom a plan is at, `t` seconds into its shot. */
export function scaleAt(plan: ZoomStep[], t: number): number | null {
  let at: number | null = null
  for (const step of plan) {
    if (step.at > t) break
    at = step.scaleExp
  }
  return at
}
