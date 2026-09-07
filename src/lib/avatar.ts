/**
 * avatar.ts - the shape others see for you, as a shard.
 *
 * Kind 33331 (decided 2026-09-07), addressable with `d` = "avatar": one per
 * pubkey, the newest wins, and it changes without a respawn. The content is
 * a shard payload as the workshop writes it. Drawn in place of the wireframe
 * dodecahedron wherever an avatar is drawn: its grid, -extent..extent, fills
 * the cell the dodecahedron fills. An empty content puts the dodecahedron
 * back.
 */

import { fromPayload, toPayload, type ShardModel } from './shards'

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

/** Render units per model unit: the whole grid fills the dodecahedron's cell, radius one half. */
export function avatarScale(shard: ShardModel): number {
  return 0.5 / Math.max(1, shard.extent)
}
