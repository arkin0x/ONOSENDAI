/**
 * shardLight.tsx: how a lit shard is lit, in one place, for every canvas that
 * draws one with `lit` (the workshop bench, the PersonModal spinning preview,
 * the feed's thumbnails). (arkinox, 2026-10-12: "the avatar modal preview and
 * the workshop seem MUCH darker than the canonical cyberspace scene. can we
 * brighten these to be closer to cyberspace?")
 *
 * The world is the reference. Out there a shard's faces are unlit
 * (meshBasicMaterial, toneMapped false): every face shows exactly its own
 * color. The bench and the preview drew the same faces with a Lambert
 * material under a dim rig, and three things stacked against them:
 *
 * 1. three r155 and later divide a Lambert face's light by pi, so the old
 *    ambient 0.4 gave 0.4 / pi = 13% of the color, and the key light at
 *    0.9 added at most 29% more. A face turned square to the key came out
 *    near 40% of its color, every other face less.
 * 2. Those faces were tone mapped. R3F's default is ACES filmic, which
 *    darkens and desaturates mid tones; the world's faces opt out of it.
 * 3. The back of a face was multiplied by "#6a6a6a", a CSS color that three's
 *    color management turns into 0.144 linear, so a back read near black.
 *
 * Here the light is stated as shares of a face's own color instead of raw
 * intensities: a front face gets AMBIENT_SHARE of its color from every side,
 * plus up to KEY_SHARE from the key light and FILL_SHARE from the fill. The
 * shares are chosen so that no front face ever goes past its full color (the
 * key and fill sit far enough apart that no face catches both at full), so a
 * face square to the key reads exactly as it does in the world and the others
 * shade down from there, enough to tell a solid's faces apart. Faces are not
 * tone mapped, as in the world.
 *
 * The back of a face (winding = front, DECK-0003 §1.4: drawn, never culled,
 * may be darkened) is the same light times BACK_SHADE, low enough that the
 * brightest back is still darker than the darkest front, so a face turned the
 * wrong way is plain to see and FLIP can turn it.
 */

import { Color } from 'three'

/** A front face's share of its own color from ambient light, on every side. */
export const AMBIENT_SHARE = 0.6
/** The most a front face gains from the key light, square to it. */
export const KEY_SHARE = 0.4
/** The most a front face gains from the fill light, square to it. */
export const FILL_SHARE = 0.2
/** The back of a face, as a share of the same light on its front. */
export const BACK_SHADE = 0.4

/** The key light: high and to one side, as the bench has always had it. */
export const KEY_POSITION: [number, number, number] = [8, 12, 6]
/** The fill: low and from behind, so faces turned from the key still differ. */
export const FILL_POSITION: [number, number, number] = [-9, 2, -3]

/**
 * Lit faces are not tone mapped, as the world's unlit faces are not: the tone
 * curve is for the bloom's highlights, and a face drawn at its own color must
 * come out at its own color.
 */
export const SHARD_FACES_TONE_MAPPED = false

/**
 * three's Lambert divides incoming light by pi (physically correct lights,
 * the only kind since r155), so a light of intensity pi gives a face its full
 * color. A share times this is the intensity that gives that share.
 */
const LAMBERT = Math.PI

export const AMBIENT_INTENSITY = AMBIENT_SHARE * LAMBERT
export const KEY_INTENSITY = KEY_SHARE * LAMBERT
export const FILL_INTENSITY = FILL_SHARE * LAMBERT

/**
 * The back's multiplier as a material color. Set in linear terms on purpose:
 * a CSS string here would go through color management and come out darker
 * than it reads (the old "#6a6a6a" was 0.144, not 0.42).
 */
export const BACK_SHADE_COLOR: Readonly<Color> = new Color().setScalar(BACK_SHADE)

function unit(v: readonly [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}

const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/**
 * The share of its own color a face shows under this rig, for the side of it
 * whose normal (toward whoever sees that side) is `normal`: its front, or with
 * `back` its back, which is lit by its own normal as the bench's inside mesh
 * is, then shaded by BACK_SHADE. Mirrors
 * the Lambert shader for these lights, so tests can hold the rig to its
 * promises without a GPU.
 */
export function faceShare(normal: readonly [number, number, number], back = false): number {
  const n = unit(normal)
  const s = AMBIENT_SHARE
    + KEY_SHARE * Math.max(0, dot(n, unit(KEY_POSITION)))
    + FILL_SHARE * Math.max(0, dot(n, unit(FILL_POSITION)))
  return back ? s * BACK_SHADE : s
}

/** The lights for a canvas that draws a lit shard. */
export function ShardLights(): JSX.Element {
  return (
    <>
      <ambientLight intensity={AMBIENT_INTENSITY} />
      <directionalLight position={KEY_POSITION} intensity={KEY_INTENSITY} />
      <directionalLight position={FILL_POSITION} intensity={FILL_INTENSITY} />
    </>
  )
}
