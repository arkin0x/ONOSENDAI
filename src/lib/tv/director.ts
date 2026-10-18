/**
 * director.ts: what Cyberspace TV shows, and when.
 *
 * The tape is every action anyone published, in the order they were signed
 * (arkinox, 2026-10-18: "basically you just witness Cyberspace's state
 * changing chronologically"). Played as it happened it would be unwatchable:
 * hours of nothing, then three people moving at once. So the tape is cut into
 * SHOTS, one avatar each, and the shots are played one after another:
 *
 * - One avatar's run of actions, with no gap longer than TRIP_GAP_S between
 *   two of them, is one trip, and a trip is one shot: the camera follows the
 *   path rather than cutting on every hop.
 * - Shots play in the order they started. When B started while A was still
 *   moving, B plays after A, from B's own start, a little in the past: "we
 *   would technically go back a little in time to start user B even though
 *   it's slightly in the past. then we dont lose anything" (arkinox,
 *   2026-10-18). Nothing is dropped.
 * - A trip longer than MAX_SHOT_S is cut into several shots, so an avatar
 *   that drifts for an hour takes turns with whoever else was out instead of
 *   holding everyone else back for the hour.
 * - A cross-space jump (a hyperjump, or any step further than JUMP_CELLS at
 *   the shot's zoom) starts a new shot: there is no fly-over across the
 *   universe, only a cut.
 * - An arrival that goes nowhere (a spawn with nothing after it) is not a
 *   shot. Over half of v2's trips are exactly that, visitors who opened the
 *   page once (census, 2026-10-18: 648 of 1,145), and cutting across the
 *   universe to each would make the tape mostly static. It is handed out as
 *   an arrival instead, for the ticker; an arrival who then moves gets a shot
 *   that starts with the spawn.
 * - Between shots, dead air is skipped (ruled 2026-10-18), and each shot holds
 *   on its avatar HOLD_S after its last action, so a cut never lands on the
 *   tail of a move.
 *
 * Pure: the store (store/useTv.ts) feeds it events as the tape loads and
 * plays the shots it releases.
 */

import type { ActionEvent, NostrEvent } from '../events'
import type { HintBox } from '../hint'
import type { Position } from '../space'

/** Longest pause inside one trip; a longer one ends the shot. 30 s covers a hop's proof on a slow phone. */
export const TRIP_GAP_S = 30
/** Longest stretch of tape one shot covers before it is cut and the others get a turn. */
export const MAX_SHOT_S = 45
/** How long the camera stays on an avatar after its last action in the shot. */
export const HOLD_S = 3
/** Screen time between two actions, at least: two hops signed in the same second still read as two. */
export const MIN_STEP_S = 0.7
/** Screen time between two actions, at most: a long think between hops is shortened, never skipped. */
export const MAX_STEP_S = 3
/** Screen time before a shot's first action, to see the avatar where it stood. */
export const LEAD_S = 1.2

/** One action on the tape. */
export interface Beat {
  id: string
  pubkey: string
  /** When it was signed, seconds. */
  at: number
  action: ActionEvent
  /** Where the avatar stood before it: the `c` tag's place, or this action's own for a spawn. */
  from: { position: Position; plane: number }
}

/**
 * Something on the tape other than a move: each is a shot of its own, a
 * segment with its own graphics (arkinox, 2026-10-18), played in its place
 * among the trips by when it was signed.
 */
export type TapeItem =
  /** A bag sealed (its newest version: relays keep only that). Where it is, only when its hint box says so. */
  | { kind: 'bag'; id: string; pubkey: string; at: number; hint: HintBox | null; height: number | null }
  /** A public SNO object published. */
  | { kind: 'object'; id: string; pubkey: string; at: number; event: NostrEvent }
  /** A comment on a move or on a bag: its words when they are public, null when sealed to a region. */
  | { kind: 'comment'; id: string; pubkey: string; at: number; text: string | null; on: 'move' | 'bag'; about: string | null }

/** How long each kind of segment stays on screen, seconds. A comment's grows with its words. */
export const BAG_S = 7
export const OBJECT_S = 7
export const COMMENT_BASE_S = 4
export const COMMENT_PER_CHAR_S = 0.05
export const COMMENT_MAX_S = 16
/** The longest quote the desk prints; a longer one is cut with an ellipsis, so it always finishes in its shot. */
export const QUOTE_MAX = 240

export function itemLength(item: TapeItem): number {
  if (item.kind === 'bag') return BAG_S
  if (item.kind === 'object') return OBJECT_S
  const chars = Math.min(QUOTE_MAX + 1, item.text?.length ?? 64)
  return Math.min(COMMENT_MAX_S, COMMENT_BASE_S + chars * COMMENT_PER_CHAR_S)
}

export interface Shot {
  /** The first beat's id: stable across reloads of the same tape. */
  id: string
  /**
   * A trip; an arrival (a spawn and nothing after it, which plays as a
   * ticker line, not a shot); or a segment for a tape item.
   */
  kind: 'trip' | 'arrival' | TapeItem['kind']
  /** The segment's item, for a bag, an object or a comment. */
  item?: TapeItem
  pubkey: string
  beats: Beat[]
  /** Tape time of the first and last beat. */
  start: number
  end: number
  /** Seconds after the shot begins at which each beat plays. */
  offsets: number[]
  /** Screen length of the whole shot, the hold included. */
  length: number
}

/** When each beat of a shot plays, from its first: the real gaps, clamped. */
export function beatOffsets(beats: Beat[]): number[] {
  const out: number[] = []
  let t = LEAD_S
  beats.forEach((b, i) => {
    if (i > 0) t += Math.min(MAX_STEP_S, Math.max(MIN_STEP_S, b.at - beats[i - 1].at))
    out.push(t)
  })
  return out
}

function shotOf(beats: Beat[]): Shot {
  const offsets = beatOffsets(beats)
  return {
    id: beats[0].id,
    kind: beats.length === 1 && beats[0].action.type === 'spawn' ? 'arrival' : 'trip',
    pubkey: beats[0].pubkey,
    beats,
    start: beats[0].at,
    end: beats[beats.length - 1].at,
    offsets,
    length: offsets[offsets.length - 1] + HOLD_S,
  }
}

/** Whether a step crosses so much space that it is a cut, not a move. */
export function isJump(b: Beat): boolean {
  if (b.action.type === 'hyperjump' || b.action.type === 'spawn' || b.from.plane !== b.action.plane) return true
  const p = b.action.position
  const q = b.from.position
  const far = (u: bigint, v: bigint): boolean => (u > v ? u - v : v - u) > JUMP_GIBSONS
  return far(p.x, q.x) || far(p.y, q.y) || far(p.z, q.z)
}

/** A step this far, in gibsons on any axis, is a cut: past it no zoom shows both ends and the avatar at once. */
export const JUMP_GIBSONS = 1n << 40n

/**
 * Cuts beats into shots as they arrive. Feed it beats in signing order with
 * `add`, tell it how far the tape has been read with `release`, and it hands
 * back, in start order, every shot that can no longer change: one whose last
 * beat is more than TRIP_GAP_S behind the read edge, or that has reached its
 * length cap.
 */
export class Director {
  private open = new Map<string, Beat[]>()
  private closed: Shot[] = []

  /** A tape item: a shot of its own at once, nothing to wait for. */
  addItem(item: TapeItem): void {
    this.closed.push({ id: item.id, kind: item.kind, item, pubkey: item.pubkey, beats: [], start: item.at, end: item.at, offsets: [], length: itemLength(item) })
  }

  add(b: Beat): void {
    const run = this.open.get(b.pubkey)
    if (run) {
      const last = run[run.length - 1]
      if (b.at - last.at > TRIP_GAP_S || b.at - run[0].at > MAX_SHOT_S || isJump(b)) {
        this.closed.push(shotOf(run))
        this.open.set(b.pubkey, [b])
        return
      }
      run.push(b)
      return
    }
    this.open.set(b.pubkey, [b])
  }

  /**
   * The shots ready to play, oldest start first, given that every beat signed
   * at or before `readTo` has been added. A shot is held back while any run
   * that started before it is still open, so the order never has to change
   * after a shot is handed out: an open run can only be followed by a shot
   * that starts later.
   */
  release(readTo: number): Shot[] {
    for (const [pk, run] of this.open) {
      const last = run[run.length - 1]
      if (readTo - last.at > TRIP_GAP_S || readTo - run[0].at > MAX_SHOT_S) {
        this.closed.push(shotOf(run))
        this.open.delete(pk)
      }
    }
    let earliestOpen = Infinity
    for (const run of this.open.values()) earliestOpen = Math.min(earliestOpen, run[0].at)
    this.closed.sort(byStart)
    const ready: Shot[] = []
    while (this.closed.length > 0 && this.closed[0].start <= earliestOpen) ready.push(this.closed.shift()!)
    return ready
  }
}

function byStart(a: Shot, b: Shot): number {
  return a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/**
 * How a shot is framed: how far the camera stands from the avatar and how
 * steeply it looks down. One distance for every shot made every shot a wide
 * one (arkinox, 2026-10-18: "vary the zoom levels on the avatars so we get
 * some variety. i dont want all the shots to be far away"), so each shot
 * draws its own from its id: mostly close-ups and medium shots, some wide.
 * Drawn from the id rather than at random, so the same tape always cuts the
 * same way. The camera pushes in a little over the shot (`from` to `to`),
 * as a broadcast camera would.
 */
export interface Framing {
  /** Camera distance at the start and the end of the shot, in cells. */
  from: number
  to: number
  /** The angle down from straight overhead, radians. */
  polar: number
  name: 'close' | 'medium' | 'wide'
}

const FRAMINGS: Array<{ name: Framing['name']; share: number; distance: number }> = [
  { name: 'close', share: 0.4, distance: 6 },
  { name: 'medium', share: 0.35, distance: 12 },
  { name: 'wide', share: 0.25, distance: 24 },
]
/** How much further out a shot starts than it ends: the push-in. */
const PUSH = 1.3

/** A number in [0, 1) from a hex id and a salt, the same every time. */
function idFraction(id: string, salt: number): number {
  const hex = id.slice(salt * 8, salt * 8 + 8).padEnd(8, '0')
  const n = parseInt(hex, 16)
  return Number.isFinite(n) ? n / 2 ** 32 : 0
}

export function shotFraming(id: string): Framing {
  const pick = idFraction(id, 0)
  let acc = 0
  let chosen = FRAMINGS[FRAMINGS.length - 1]
  for (const f of FRAMINGS) {
    acc += f.share
    if (pick < acc) { chosen = f; break }
  }
  // Between nearly overhead (0.35) and low over the shoulder (1.05).
  const polar = 0.35 + idFraction(id, 1) * 0.7
  return { from: chosen.distance * PUSH, to: chosen.distance, polar, name: chosen.name }
}
