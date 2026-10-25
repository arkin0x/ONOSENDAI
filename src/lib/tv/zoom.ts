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
 * within MOVE_FIT_CELLS, half the FIT_CELLS a whole trip is framed in: the
 * camera eases after the avatar, and a glide across a whole frame left it
 * at the edge of the picture (review of #470). The trip is cut into spans of
 * moves that share a zoom: a move that needs a wider zoom starts a new span,
 * and so does a move ZOOM_IN_STEPS or more powers of two finer than the
 * span's. A span with wider zooms on both sides (a dip: in, then straight
 * back out) is not worth zooming in for, and plays at the nearer of the two,
 * when it has fewer than MIN_HOLD_BEATS moves or would be held at its own
 * zoom for less than MIN_DIP_HOLD_S: the time between the zoom in landing
 * and the zoom out starting, after the wide hold and both changes, not the
 * span's length (review of #470: six 0.7 s nudges between big hops breathed
 * in and out eight times a shot, a third of a second at the fine zoom
 * each). So a trip that alternates small and large moves holds the wide zoom
 * instead of pumping in and out. A span at either end of the trip with a
 * wider neighbour is kept only for MIN_HOLD_BEATS moves or more. A step on
 * the way out or in (finer on one side, wider on the other) keeps its zoom:
 * it is no pump. A large move always gets the zoom it needs: a move wider
 * than the frame would fly out of it.
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
 * path), and no trip ever plays wider than its whole path's zoom, so a move
 * that is most of its trip's path plays at the whole path's zoom. Screen
 * time is not changed: the zoom rides on the director's offsets
 * (director.ts).
 *
 * Pure: the store (store/useTv.ts) asks it for a shot's plan when the shot
 * begins and plays the plan against the shot's clock, stepping in one power
 * of two a tick at most (a change of many powers is quicker than its tick).
 */

import { AVATAR_LERP_MS } from '../avatarLerp'
import { MAX_SCALE_EXP, type Position } from '../space'
import { isJump, type Beat } from './director'

/** A shot is framed so its whole path fits in about this many cells across. */
export const FIT_CELLS = 12
/**
 * A move is played at the zoom that fits it in this many cells: one power of
 * two wider than FIT_CELLS. The camera follows the avatar eased (TvLayer
 * TV_FOLLOW_TAU), and across a 12-cell glide it fell up to 6.3 cells behind,
 * past the edge of a close shot (about 5.5 cells either side of the middle);
 * across 6 cells it is about 3 behind, 4 on a run of them (review of #470).
 * Nudges of up to 6 gibsons are as big on screen as before.
 */
export const MOVE_FIT_CELLS = 6
/** A move this many powers of two finer than the zoom it plays at, or more, is worth zooming in for. */
export const ZOOM_IN_STEPS = 2
/**
 * A dip's finer zoom is on screen at least this long, seconds, from the zoom
 * in landing to the zoom out starting, or it is not taken (review of #470).
 */
export const MIN_DIP_HOLD_S = 2
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

/** The zoom that holds a span of `extent` gibsons within `cells`. */
function extentScale(extent: bigint, cells: number): number {
  let exp = 0
  while ((extent >> BigInt(exp)) > BigInt(cells) && exp < MAX_SCALE_EXP) exp++
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
  return extentScale(extent, FIT_CELLS)
}

/** The zoom one beat's move asks for (MOVE_FIT_CELLS); null for an opening jump, which is a cut onto where it lands, not a move. */
export function moveScale(b: Beat, first: boolean): number | null {
  if (first && isJump(b)) return null
  return extentScale(span(b.from.position, b.action.position), MOVE_FIT_CELLS)
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
  // Too few moves to zoom in for: a dip, or the trip's first or last span in
  // from or out to a wider zoom, with fewer than MIN_HOLD_BEATS moves.
  const tooFew = (k: number): boolean => {
    const prev = spans[k - 1]
    const next = spans[k + 1]
    if (spans[k].last - spans[k].first + 1 >= MIN_HOLD_BEATS) return false
    const widerBefore = prev !== undefined && prev.scaleExp > spans[k].scaleExp
    const widerAfter = next !== undefined && next.scaleExp > spans[k].scaleExp
    // A dip, in and straight back out; or the first or last span. A step on
    // the way out or in, or the only span, keeps its zoom.
    return (widerBefore && widerAfter) || (widerBefore && next === undefined) || (widerAfter && prev === undefined)
  }
  // Played at `to`, wider than its own zoom, and joined to a neighbour there.
  const lift = (k: number, to: number): boolean => {
    if (!(to > spans[k].scaleExp)) return false
    spans[k].scaleExp = to
    spans = merged(spans)
    return true
  }
  // Played at the nearer wider neighbour's zoom.
  const raise = (k: number): boolean => {
    const wider = [spans[k - 1], spans[k + 1]].filter((n): n is Span => n !== undefined && n.scaleExp > spans[k].scaleExp)
    return wider.length > 0 && lift(k, Math.min(...wider.map((n) => n.scaleExp)))
  }
  // One at a time, the finest first (then the shortest), until none is left:
  // a lone nudge joins the run beside it before that run is judged. Then the
  // plan is made, and a dip it holds at its own zoom for less than
  // MIN_DIP_HOLD_S is played at the nearer of the zooms on screen either side
  // of it (the finest first, then the briefest; a neighbour too brief to be
  // stepped in to is not on screen, so it is not the one that counts), and
  // the plan made again, until every dip on screen holds.
  for (;;) {
    let pick = -1
    let pickLen = Infinity
    for (let k = 0; k < spans.length; k++) {
      const len = endOf(k) - startOf(k)
      if (!tooFew(k)) continue
      if (pick < 0 || spans[k].scaleExp < spans[pick].scaleExp || (spans[k].scaleExp === spans[pick].scaleExp && len < pickLen)) { pick = k; pickLen = len }
    }
    if (pick >= 0 && raise(pick)) continue
    const made = steps(spans, whole, offsets, prelude)
    const brief = made.dips.filter((d) => d.held < MIN_DIP_HOLD_S)
      .sort((a, b) => spans[a.k].scaleExp - spans[b.k].scaleExp || a.held - b.held)
    if (!brief.some((d) => lift(d.k, d.wider))) return made.plan
  }
}

/**
 * A trip's zoom plan from its spans: the steps, and each dip (a span the
 * zoom steps in to and then out of) with how long it is held at its own zoom,
 * from the zoom in landing to the zoom out starting, and the nearer of the
 * zooms on screen before and after it.
 */
function steps(spans: Span[], whole: number, offsets: number[], prelude: number): { plan: ZoomStep[]; dips: Array<{ k: number; held: number; wider: number }> } {
  const zoomOf = (k: number): number => Math.min(whole, spans[k].scaleExp)
  const takes = (n: number): number => Math.min(ZOOM_MAX_S, n * ZOOM_STEP_S)
  const plan: ZoomStep[] = [{ at: 0, scaleExp: zoomOf(0) }]
  const dips: Array<{ k: number; held: number; wider: number }> = []
  let from = zoomOf(0)
  // When the last change ended (nothing changes during a hyperjump's ride), and when the zoom on screen was reached.
  let free = prelude
  let reached = prelude
  // The span whose zoom is on screen, whether the zoom stepped in to it, and from what.
  let shown = 0
  let inTo = false
  let inFrom = 0
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
    // Out of a span the zoom stepped in to: a dip, held from then till now.
    if (to > from && inTo) dips.push({ k: shown, held: start - reached, wider: Math.min(inFrom, to) })
    for (let j = 1; j <= n; j++) plan.push({ at: start + ((end - start) * j) / n, scaleExp: from + (to > from ? j : -j) })
    free = end
    reached = end
    inTo = to < from
    inFrom = from
    from = to
    shown = k
  }
  return { plan, dips }
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
