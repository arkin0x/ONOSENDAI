/**
 * blocksClient.ts - TERRAIN's field asks the blocks worker for a chunk's
 * ground, mesh or light.
 *
 * One worker, made the first time TERRAIN needs it and let go when TERRAIN
 * closes (releaseBlocksWorker), so nothing runs while you are not building.
 * Where no worker can start, or the one there fails, the same code runs here
 * on the page (lib/terrain/blocksJob.ts): slower for a frame, never wrong.
 * The client itself is lib/terrain/makeBlocksClient.ts; Cyberspace TV has a
 * client of its own (store/useTvTerrain.ts), so neither lets the other's
 * worker go.
 */

import type { ChunkBase } from './coords'
import type { GroundRevision } from './generate'
import type { Borders, ChunkMesh } from './mesh'
import { makeBlocksClient, type GroundAnswer } from './makeBlocksClient'

const field = makeBlocksClient()

/**
 * A chunk's generated ground at a revision (DECK-0009 §3.10; lib/terrain/groundRevision.ts), its family's top and rind
 * ids (DECK ids), and its family and terrain K for the survey card (lib/terrain/assay.ts).
 */
export function generateChunk(base: ChunkBase, revision: GroundRevision): Promise<GroundAnswer> {
  return field.generateChunk(base, revision)
}

/** A chunk's mesh, from a copy of its blocks (the caller keeps its own). */
export function meshChunkAsync(blocks: Uint8Array, borders: Borders): Promise<ChunkMesh> {
  return field.meshChunkAsync(blocks, borders)
}

/**
 * A chunk's light (light.ts computeLight): from copies of the chunk and its
 * 26 neighbours' blocks (null where open space), and which columns are open
 * above them.
 */
export function lightChunkAsync(around: ReadonlyArray<Uint8Array | null>, skyTop: Uint8Array | null): Promise<Uint8Array<ArrayBuffer>> {
  return field.lightChunkAsync(around, skyTop)
}

/** Let the worker go: TERRAIN closed. Jobs still out are answered with an error: nobody wants them now, and redoing them here would stall the page. */
export function releaseBlocksWorker(): void {
  field.release('TERRAIN closed')
}
