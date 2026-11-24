/**
 * blocksJob.ts - the work the blocks worker does (workers/blocks.worker.ts),
 * as plain functions, so the page can run the same code when no worker can
 * start (tests, a browser that refuses one) and the answer is the same.
 */

import { tileTable } from './blocks'
import type { ChunkBase } from './coords'
import { generate } from './generate'
import { meshChunk, type Borders, type ChunkMesh } from './mesh'

export type BlocksRequest =
  | { type: 'generate'; id: number; base: ChunkBase }
  | { type: 'mesh'; id: number; blocks: Uint8Array; borders: Borders }

export type BlocksAnswer =
  | { type: 'generate'; id: number; blocks: Uint8Array; top: number; rind: number; ms: number }
  | { type: 'mesh'; id: number; mesh: ChunkMesh; ms: number }
  | { type: 'error'; id: number; message: string }

let tiles: Uint8Array | null = null

/** Answer one request, with the buffers to transfer back. */
export function handleBlocks(req: BlocksRequest): { answer: BlocksAnswer; transfer: Transferable[] } {
  const t0 = performance.now()
  try {
    if (req.type === 'generate') {
      const g = generate(req.base)
      return { answer: { type: 'generate', id: req.id, blocks: g.blocks, top: g.top, rind: g.rind, ms: performance.now() - t0 }, transfer: [g.blocks.buffer] }
    }
    tiles ??= tileTable()
    const mesh = meshChunk(req.blocks, req.borders, tiles)
    return { answer: { type: 'mesh', id: req.id, mesh, ms: performance.now() - t0 }, transfer: [mesh.vertices.buffer, mesh.indices.buffer] }
  } catch (err) {
    return { answer: { type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) }, transfer: [] }
  }
}
