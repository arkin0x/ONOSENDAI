/**
 * walkBounce.ts - BOUNCE, EXPERIMENTAL (arkinox, 2026-11-10: "we could try
 * out a bounce feature when gravity is on?"), for the AeroCarnival kit's
 * trampolines and bounce pads. Its shape is ruled (D5, 2026-11-10): a flat
 * payload field beside `constrain`, a whole number 1 to 24 or "reflect",
 * launching on landings only, and Down absorbs. It is not yet written into
 * DECK-0003, so it stays EXPERIMENTAL until it is.
 *
 * An object-level SNO field, `bounce`, read by a walker landing on one of the
 * object's faces with GRAVITY on (store/useWalk.ts):
 *
 * | The payload says | The walker is launched to |
 * |---|---|
 * | a whole number from BOUNCE_MIN to BOUNCE_MAX | that many gibsons above where it landed |
 * | `"reflect"` (arkinox, 2026-11-10: "a bounce option that simply reflects whatever height you fell from") | the height its fall's top was above where it landed, at most BOUNCE_MAX, so it bounces in place forever until it moves off in the air or gravity goes off |
 * | anything else (absent, a fraction, out of range, another string) | nowhere: no bounce |
 *
 * A second flat field, `springboard` (arkinox, 2026-11-10: "a springboard
 * option where touching the pad will launch you even if you walk onto it
 * flush"), exactly `true` and nothing else, makes a fixed-height pad launch
 * on any arrival onto its top: a level walk onto it (a pad flush with the
 * floor), a step up or down onto it, or a landing. Without it a pad launches
 * on landings, and on a step up onto a fixed height (decided 2026-11-10; not an owner ruling).
 * With "reflect" it adds nothing: walking on, you fell from nowhere, so the
 * reflected height is 0 and only landings launch. Touching counts: walking
 * along the exact seam between a plain floor and a flush springboard
 * launches, as intended ("touching the pad will launch you"). A Down press
 * just before walking on keeps you standing.
 *
 * An Up press just before the landing adds JUMP_HEIGHT to either, still at
 * most BOUNCE_MAX; a Down press just before it absorbs the bounce, and the
 * walker lands and stands. Stepping up onto a fixed-height pad (the stair
 * step-up) launches as a landing would; onto a "reflect" pad it does
 * nothing, since it fell from nowhere (decided 2026-11-10; not an owner ruling). sno-core does
 * not know the field, so it rides in the model's `extra` like `constrain`
 * (lib/walkConstrain.ts), and an older reader passes it through untouched.
 *
 * Up, above and the top are against the walker's gravity (lib/walkDown.ts):
 * cyberspace +Y in the default view, along X or Z once the view is turned
 * (arkinox, 2026-11-10), so a pad throws you the way JUMP does.
 *
 * Whose `bounce` a face has: the payload that owns the face, as each object
 * is judged by its own `constrain` (§1.10). A shard's own faces bounce by the
 * shard's field; the faces of an object it places bounce by that object's,
 * never by the parent's. A face that does not collide (constrain OFF, or
 * OPAQUE while see-through) is not there to land on, so it never bounces.
 */

import type { ShardModel } from 'sno-core/shards'

/** The payload field (provisional). */
export const BOUNCE_FIELD = 'bounce'

/** The lowest launch, in gibsons. */
export const BOUNCE_MIN = 1

/** The highest launch, in gibsons. */
export const BOUNCE_MAX = 24

/** The word for a bounce back to the height fallen from. */
export const BOUNCE_REFLECT = 'reflect'

/** A face's bounce: a launch height in gibsons, BOUNCE_REFLECT, or 0 for none. */
export type Bounce = number | typeof BOUNCE_REFLECT

/** A payload's `bounce`: a whole number from BOUNCE_MIN to BOUNCE_MAX, or `"reflect"` exactly; anything else 0 (no bounce). */
export function readBounce(raw: unknown): Bounce {
  if (raw === BOUNCE_REFLECT) return raw
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= BOUNCE_MIN && raw <= BOUNCE_MAX ? raw : 0
}

/** How far under a whole gibson a reflected fall may be and still count as it: float error only. */
const REFLECT_EPS = 1e-6

/**
 * How high a landing on a face with bounce `b` launches, in gibsons, after a
 * fall whose top was `fell` gibsons above the landing (for "reflect",
 * rounded down, a hair's float error forgiven), with `boost` (an Up
 * press just before it) adding JUMP_HEIGHT `boostBy`: at most BOUNCE_MAX, and
 * 0 (no launch) under BOUNCE_MIN.
 */
export function launchHeight(b: Bounce, fell: number, boost: boolean, boostBy: number): number {
  if (b === 0) return 0
  const base = b === BOUNCE_REFLECT ? Math.floor(fell + REFLECT_EPS) : b
  const h = Math.min(BOUNCE_MAX, base + (boost ? boostBy : 0))
  return h >= BOUNCE_MIN ? h : 0
}

/** The springboard field (provisional). */
export const SPRINGBOARD_FIELD = 'springboard'

/** A payload's `springboard`: exactly `true`; anything else (`"true"`, 1, absent) is no springboard. */
export function readSpringboard(raw: unknown): boolean {
  return raw === true
}

/** A model's springboard, top level first, as bounceOf reads `bounce`. */
export function springboardOf(s: Pick<ShardModel, 'extra'>): boolean {
  const top = (s as { springboard?: unknown }).springboard
  return readSpringboard(top !== undefined ? top : s.extra?.[SPRINGBOARD_FIELD])
}

/** A model's bounce, top level first for a sno-core that has learned the field (as constrainOf reads `constrain`). */
export function bounceOf(s: Pick<ShardModel, 'extra'>): Bounce {
  const top = (s as { bounce?: unknown }).bounce
  return readBounce(top !== undefined ? top : s.extra?.[BOUNCE_FIELD])
}

/**
 * The workshop's BOUNCE control (arkinox, 2026-11-10: "can i make bounce
 * surfaces in the workshop now then?"): the heights it offers in one tap,
 * the one HEIGHT starts at, and the writer every press goes through.
 */
export const BOUNCE_PRESETS: readonly number[] = [3, 6, 12, 18, 24]

/** Where HEIGHT starts from OFF or REFLECT: the owner's own test pads launch 12. */
export const BOUNCE_START = 12

/** `n` as a fixed height the payload can carry: whole, BOUNCE_MIN to BOUNCE_MAX. */
export function clampBounce(n: number): number {
  if (!Number.isFinite(n)) return BOUNCE_START
  return Math.min(BOUNCE_MAX, Math.max(BOUNCE_MIN, Math.round(n)))
}

/**
 * `s` with its bounce at `b` and its springboard at `springboard`, written only
 * as readBounce and readSpringboard read them: `bounce` a whole number
 * BOUNCE_MIN to BOUNCE_MAX or `"reflect"`, `springboard` exactly `true` and
 * only beside a fixed height, since with REFLECT it adds nothing. Anything
 * else (0, a fraction, out of range, another word) is no bounce, and no
 * bounce removes both fields, so a shard turned OFF carries neither. Written
 * into `extra`, beside `constrain`; a top-level copy (a sno-core that has
 * learned the field) is dropped, so it can never shadow the new value. The
 * same object when it already says exactly that, so a press that changes
 * nothing is no edit.
 *
 * When `bounce` is promoted into DECK-0003, sno-core needs a lift for
 * `bounce` and `springboard` (as it has for its other known fields, so
 * toPayload and fromPayload carry them at the top level), and this writer
 * should then write them at the top level instead of into `extra`.
 */
export function withBounce<T extends ShardModel>(s: T, raw: unknown, springboard = false): T {
  const b = readBounce(raw)
  const spring = springboard === true && typeof b === 'number' && b !== 0
  const top = s as { bounce?: unknown; springboard?: unknown }
  const extra = s.extra ?? {}
  const want = { bounce: b === 0 ? undefined : b, springboard: spring ? true : undefined }
  const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(extra, k)
  if (top.bounce === undefined && top.springboard === undefined
    && extra[BOUNCE_FIELD] === want.bounce && has(BOUNCE_FIELD) === (want.bounce !== undefined)
    && extra[SPRINGBOARD_FIELD] === want.springboard && has(SPRINGBOARD_FIELD) === (want.springboard !== undefined)) return s
  const { extra: _old, bounce: _b, springboard: _s, ...rest } = s as T & { bounce?: unknown; springboard?: unknown }
  const kept: Array<[string, unknown]> = Object.entries(extra).filter(([k]) => k !== BOUNCE_FIELD && k !== SPRINGBOARD_FIELD)
  if (want.bounce !== undefined) kept.push([BOUNCE_FIELD, want.bounce])
  if (want.springboard) kept.push([SPRINGBOARD_FIELD, true])
  return (kept.length ? { ...rest, extra: Object.fromEntries(kept) } : rest) as unknown as T
}

/**
 * A shard's bounce in a word or two, for its chip in the workshop's list and
 * SHARD panel: BOUNCE 12, SPRING 12 (a springboard), REFLECT, or null for none.
 */
export function bounceChip(s: Pick<ShardModel, 'extra'>): string | null {
  const b = bounceOf(s)
  if (b === 0) return null
  if (b === BOUNCE_REFLECT) return 'REFLECT'
  return `${springboardOf(s) ? 'SPRING' : 'BOUNCE'} ${b}`
}

/** The chip's tooltip. */
export function bounceChipTip(s: Pick<ShardModel, 'extra'>): string {
  const b = bounceOf(s)
  if (b === 0) return ''
  if (b === BOUNCE_REFLECT) return 'Bounces walkers back to the height they fell from'
  return `Launches walkers ${b} gibsons${springboardOf(s) ? ', on walk-on too' : ''}`
}
