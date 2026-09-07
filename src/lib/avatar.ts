/**
 * avatar.ts - the shape others see for you, as a shard.
 *
 * Kind 33331 (decided 2026-09-07), addressable with `d` = "avatar": one per
 * pubkey, the newest wins, and it changes without a respawn. The content is
 * a shard payload as the workshop writes it. Drawn in place of the wireframe
 * dodecahedron wherever an avatar is drawn, at true scale: one gibson on the
 * bench is one cell, the size the white avatar shows there. An empty content
 * puts the dodecahedron back.
 */

import { TICKS_PER_UNIT, fromPayload, ticksOf, toPayload, type ShardModel } from './shards'

export const AVATAR_KIND = 33331
export const AVATAR_D = 'avatar'

export interface AvatarTemplate { kind: number; created_at: number; tags: string[][]; content: string }

/** The event to sign: this shard as the avatar, or none for the dodecahedron. */
export function avatarTemplate(shard: ShardModel | null, createdAt: number): AvatarTemplate {
  return {
    kind: AVATAR_KIND,
    created_at: createdAt,
    tags: [['d', AVATAR_D], ...(shard ? [['name', shard.name]] : [])],
    content: shard ? JSON.stringify(toPayload(shard)) : '',
  }
}

/** The shard an avatar event carries, or null when it carries none or is not one. */
export function avatarFromEvent(ev: { kind: number; pubkey: string; content: string; tags: string[][] }): ShardModel | null {
  if (ev.kind !== AVATAR_KIND) return null
  if (!ev.tags.some((t) => t[0] === 'd' && t[1] === AVATAR_D)) return null
  if (!ev.content) return null
  try {
    return fromPayload(JSON.parse(ev.content), `avatar:${ev.pubkey}`)
  } catch {
    return null
  }
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
