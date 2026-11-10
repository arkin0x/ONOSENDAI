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
 * An Up press just before the landing adds JUMP_HEIGHT to either, still at
 * most BOUNCE_MAX; a Down press just before it absorbs the bounce, and the
 * walker lands and stands. Stepping up onto a fixed-height pad (the stair step-up)
 * launches as a landing would; onto a "reflect" pad it does nothing, since it
 * fell from nowhere (ruling of 2026-11-10). sno-core does not know the field, so it rides in the
 * model's `extra` like `constrain` (lib/walkConstrain.ts), and an older
 * reader passes it through untouched.
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

/** A model's bounce, top level first for a sno-core that has learned the field (as constrainOf reads `constrain`). */
export function bounceOf(s: Pick<ShardModel, 'extra'>): Bounce {
  const top = (s as { bounce?: unknown }).bounce
  return readBounce(top !== undefined ? top : s.extra?.[BOUNCE_FIELD])
}
