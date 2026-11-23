/**
 * bloomShard.ts - a bloom's geometry as a shard the scene already draws.
 *
 * The seeds worker posts a drawn bloom as typed arrays (sno-core BloomBuffers,
 * transferred, never cloned). The scene draws shards, so the buffers become a
 * ShardModel here, exactly the model sno-core's fromPayload makes of the
 * bloom's SNO payload (DECK-0008 §5.5): whole units and ticks split per axis,
 * colours from the built-in palette, and the wire's Z turned into the
 * model's (fromPayload's flipZ). A bloom stands at its seed's `C`, one model
 * unit 2^scale gibsons (§5.6). A bloom whose expressed `opacity` gene is
 * below 100 carries it in the buffers exactly when its payload does (§5.4,
 * §5.5), and the shard keeps it, so the scene draws the bloom see-through as
 * it draws any shard with an opacity. A test holds the two equal.
 */

import { neededExtent, vertexAt, type ShardModel, type ShardVertex } from 'sno-core/shards'
import { BUILT_IN, colorAt } from 'sno-core/snoPalette'
import type { BloomBuffers } from 'sno-core/seeds'

/** The shard a bloom draws as. `id` keys its geometry in the scene, so it changes whenever the bloom does. */
export function bloomShard(buffers: BloomBuffers, name: string, unit: number, id: string): ShardModel {
  const { positions, colors, faces, opacity } = buffers
  const count = colors.length
  const vertices: ShardVertex[] = new Array(count)
  for (let i = 0; i < count; i++) {
    // `0 - z`, as fromPayload's flipZ writes it: never a -0.
    vertices[i] = vertexAt([positions[i * 3], positions[i * 3 + 1], 0 - positions[i * 3 + 2]], colorAt(BUILT_IN, colors[i]))
  }
  const tris: Array<[number, number, number]> = new Array(faces.length / 3)
  for (let f = 0; f < tris.length; f++) tris[f] = [faces[f * 3], faces[f * 3 + 1], faces[f * 3 + 2]]
  return {
    id,
    name: name.slice(0, 64) || 'bloom',
    unit,
    // The payload's extent is the reach of its vertices (§5.5), which is what fromPayload keeps.
    extent: neededExtent({ vertices }),
    mode: 'solid',
    vertices,
    faces: tris,
    up: false,
    spin: 0,
    updatedAt: 0,
    // After `faces`, only below 100, as the payload writes it (DECK-0008 §5.5).
    ...(opacity !== undefined ? { opacity } : {}),
  }
}
