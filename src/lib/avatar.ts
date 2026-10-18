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
import { CLIENT_TAG } from './client'

export const AVATAR_KIND = 11333

export interface AvatarTemplate { kind: number; created_at: number; tags: string[][]; content: string }

/** The event to sign: this shard as the avatar, or none for the dodecahedron. */
export function avatarTemplate(shard: ShardModel | null, createdAt: number): AvatarTemplate {
  return {
    kind: AVATAR_KIND,
    created_at: createdAt,
    // No `d`: a replaceable kind has no second key, and writing one would
    // only invite a reader to filter on it. The client tag is here and not
    // added at signing because the work is mined over these tags (client.ts).
    tags: shard ? [['name', shard.name], [...CLIENT_TAG]] : [[...CLIENT_TAG]],
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
 * Widest an avatar may reach from its centre, in gibsons (cells at 2^0): a
 * shard built beyond this is shrunk to it, so nobody's avatar blots out the
 * field.
 */
export const MAX_AVATAR_RADIUS = 4

/** How far a shard reaches from its centre, in gibsons, before the cap. */
function shardRadius(shard: ShardModel): number {
  let reach = 0
  for (const v of shard.vertices) {
    const t = ticksOf(v)
    reach = Math.max(reach, Math.abs(t[0]), Math.abs(t[1]), Math.abs(t[2]))
  }
  return (reach / TICKS_PER_UNIT) * 2 ** shard.unit
}

/**
 * Render units per model unit at 2^0: true scale. A model unit is 2^unit
 * gibsons, and the dodecahedron's cell is one gibson at 2^0, so a shard built
 * to the white avatar on the bench comes out exactly that size there. What
 * the zoom does to it is avatarDraw's.
 */
export function avatarScale(shard: ShardModel): number {
  const perUnit = 2 ** shard.unit
  const radius = shardRadius(shard)
  return radius > MAX_AVATAR_RADIUS ? perUnit * (MAX_AVATAR_RADIUS / radius) : perUnit
}

/** The marker's half-extent in cells: the wireframe icosahedron, one cell across. */
export const AVATAR_MARKER_HALF = 0.5

/**
 * How a shard avatar is drawn at zoom 2^scaleExp: its mesh, scaled like
 * everything else, or the marker once the mesh is too small to read.
 *
 * At 2^s a cell is 2^s gibsons, so an avatar whose true half-extent is E
 * gibsons is E / 2^s cells. It used to be drawn at its 2^0 size at every
 * zoom, which was harmless for the one-cell dodecahedron and wrong for a
 * shard: up to eight cells across at any zoom, so zooming out with a big
 * avatar following you put it over the whole screen while the room shrank
 * around it (arkinox, 2026-10-13, XOR following him).
 *
 * Once zooming has shrunk the mesh under the marker's size it becomes the
 * marker, the one-cell icosahedron every plain avatar is, rather than a
 * speck or a mesh inflated past its real size. At 2^0 a shard is always its
 * mesh, however small it was built.
 */
export function avatarDraw(shard: ShardModel, scaleExp: number): { mesh: number } | 'marker' {
  const zoom = 2 ** -scaleExp
  const half = Math.min(shardRadius(shard), MAX_AVATAR_RADIUS) * zoom
  if (scaleExp > 0 && half < AVATAR_MARKER_HALF) return 'marker'
  return { mesh: avatarScale(shard) * zoom }
}

/**
 * The same, never the marker: once the mesh would be smaller than the marker,
 * the mesh at the marker's size instead (`markerScale` is the marker's own
 * shrink at the top of the ladder, spectatorScale). For Cyberspace TV, which
 * frames each shot at the zoom that fits its trip: one avatar was its own
 * shape in one shot and the white marker in the next (arkinox, 2026-10-18:
 * "i just saw a tv segment where i was moving with my custom avatar and the
 * very next shot my avatar was a white dodecahedron"). On TV who it is
 * matters more than its true size.
 */
export function avatarDrawKept(shard: ShardModel, scaleExp: number, markerScale: number): { mesh: number } {
  const draw = avatarDraw(shard, scaleExp)
  if (draw !== 'marker') return draw
  const radius = Math.max(1e-9, Math.min(shardRadius(shard), MAX_AVATAR_RADIUS))
  return { mesh: (avatarScale(shard) * AVATAR_MARKER_HALF * markerScale) / radius }
}
