/**
 * thumbKey.ts: the name a shard's picture is kept under (2026-10-23).
 *
 * Wherever shards are listed each row wears a picture of its shape
 * (hud/ShardThumb.tsx), drawn once by the one hidden canvas and kept
 * (store/useThumbs, lib/thumbDb). A picture is of a shape, so it is kept
 * under a hash of exactly what the picture shows: the mode, the vertices
 * with their colours, the faces, the face colours, and what the object
 * places with how it places them, and the objects it carries for those
 * placements (DECK-0003 §1.10), since they are what is drawn there. The name, the id and the time of the last
 * edit are left out. An edit to the shape is a new key, so the row asks for
 * a new picture; a rename keeps the old one. A model in the workshop and the
 * same object in the feed share one picture.
 *
 * LOOK is part of every key. Change how the pictures are drawn (the camera,
 * the light, the size) and bump it, so every kept picture is drawn again.
 */

import type { ShardModel } from 'sno-core/shards'

/** Bump when the pictures are drawn differently, so none drawn before is shown again. */
export const LOOK = 1

/**
 * A 53 bit hash of a string (cyrb53, public domain), as 14 hex digits. Not
 * for security: two shapes would need to collide for a row to show the
 * other's picture.
 */
export function hash53(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

/** Whether a shard places other objects: its picture also depends on theirs, which can change under it. */
export function isComposite(shard: ShardModel): boolean {
  return (shard.refs?.length ?? 0) > 0 && (shard.parts?.length ?? 0) > 0
}

const keys = new WeakMap<ShardModel, string>()

/**
 * The key of a shard's picture. Kept per shard object, so a list drawn again
 * hashes nothing; an edit makes a new object, which is hashed once.
 */
export function thumbKeyOf(shard: ShardModel): string {
  const kept = keys.get(shard)
  if (kept) return kept
  // The unit matters only to how big a placed object is beside this one's own vertices.
  const composite = isComposite(shard)
  // The carried objects only when there are any, so every key made before they existed stays as it was.
  const carried = composite && shard.objects ? [shard.objects] : []
  const text = JSON.stringify([LOOK, shard.mode, shard.vertices, shard.faces, shard.facecolors ?? null, composite ? shard.refs : null, composite ? shard.parts : null, composite ? shard.unit : 0, ...carried])
  const key = `shape:${hash53(text)}${hash53(text, 0x9e3779b9)}`
  keys.set(shard, key)
  return key
}
