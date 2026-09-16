/**
 * avatar.ts - the shape others see for you, as a shard.
 *
 * Kind 11333, replaceable: one per pubkey, the newest wins, and it changes
 * without a respawn. It was 33331, addressable with a `d` fixed at "avatar",
 * which is emulating replaceable semantics with the wrong tool: a constant `d`
 * asks every reader to trust a convention where the relay could enforce the
 * rule. Spec 8.10. The break was clean because nothing was published: a query
 * for 33331 across four relays returned nothing while the same query returned
 * bags and movement. 33331 now belongs to a standalone SNO object, where a `d`
 * the author chooses is a real key. The content is
 * a shard payload as the workshop writes it. Drawn in place of the wireframe
 * dodecahedron wherever an avatar is drawn, at true scale: one gibson on the
 * bench is one cell, the size the white avatar shows there. An empty content
 * puts the dodecahedron back.
 */

import { TICKS_PER_UNIT, fromPayload, ticksOf, toPayload, type ShardModel } from 'sno-core/shards'

export const AVATAR_KIND = 11333

export interface AvatarTemplate { kind: number; created_at: number; tags: string[][]; content: string }

/** The event to sign: this shard as the avatar, or none for the dodecahedron. */
export function avatarTemplate(shard: ShardModel | null, createdAt: number): AvatarTemplate {
  return {
    kind: AVATAR_KIND,
    created_at: createdAt,
    // No `d`: a replaceable kind has no second key, and writing one would
    // only invite a reader to filter on it.
    tags: shard ? [['name', shard.name]] : [],
    content: shard ? JSON.stringify(toPayload(shard)) : '',
  }
}

/** The shard an avatar event carries, or null when it carries none or is not one. */
export function avatarFromEvent(ev: { kind: number; pubkey: string; content: string; tags: string[][] }): ShardModel | null {
  if (ev.kind !== AVATAR_KIND) return null
  if (!ev.content) return null
  try {
    return fromPayload(JSON.parse(ev.content), `avatar:${ev.pubkey}`)
  } catch {
    return null
  }
}

/**
 * Where the avatar stops being a place and starts being a dot.
 *
 * An avatar is one cell across at every zoom, which is right nearly
 * everywhere: the cell is the unit you move in, so a marker that fills it says
 * "here" exactly. It stops being right at the top of the ladder. Cyberspace is
 * 2^85 gibsons on a side, so a cell at 2^84 is half the cube per axis, an
 * eighth of it by volume, and an avatar filling that says almost nothing about
 * where anybody is. Spectating someone at full zoom out showed a shape the
 * size of an octant and no way to tell which part of the cube it sat in.
 *
 * So from 2^80 up the avatar halves with every step out, reaching a sixteenth
 * of a cell at 2^84, which is a thirty-second of cyberspace across: small
 * enough to point at a place, large enough to still be a shape. Below 2^80
 * nothing changes, because nothing was wrong there.
 *
 * Halving per step rather than a fixed small size on purpose: the avatar then
 * holds a constant size in gibsons across the whole spectator range instead of
 * doubling in real terms at each step out, so zooming out reads as pulling
 * away from something rather than watching it grow to meet you.
 */
export const SPECTATOR_SCALE_MIN_EXP = 80

/** How much to shrink an avatar drawn at this zoom. 1 below the spectator range. */
export function spectatorScale(scaleExp: number): number {
  if (scaleExp <= SPECTATOR_SCALE_MIN_EXP) return 1
  return 2 ** -(scaleExp - SPECTATOR_SCALE_MIN_EXP)
}

/**
 * Widest an avatar may reach from its centre, in cells: a shard built beyond
 * this is shrunk to it, so nobody's avatar blots out the field.
 */
export const MAX_AVATAR_RADIUS = 4

/**
 * Render units per model unit: true scale. A model unit is 2^unit gibsons,
 * and the dodecahedron's cell is one gibson at 2^0, so a shard built to the
 * white avatar on the bench comes out exactly that size. The avatar keeps
 * that size at every zoom, as the dodecahedron does.
 */
export function avatarScale(shard: ShardModel): number {
  const perUnit = 2 ** shard.unit
  let reach = 0
  for (const v of shard.vertices) {
    const t = ticksOf(v)
    reach = Math.max(reach, Math.abs(t[0]), Math.abs(t[1]), Math.abs(t[2]))
  }
  const radius = (reach / TICKS_PER_UNIT) * perUnit
  return radius > MAX_AVATAR_RADIUS ? perUnit * (MAX_AVATAR_RADIUS / radius) : perUnit
}
