/**
 * blocksClient.ts - asks the blocks worker for a chunk's ground or mesh.
 *
 * One worker, made the first time TERRAIN needs it and let go when TERRAIN
 * closes (releaseBlocksWorker), so nothing runs while you are not building.
 * Where no worker can start, or the one there fails, the same code runs here
 * on the page (lib/terrain/blocksJob.ts): slower for a frame, never wrong.
 */

import type { ChunkBase } from './coords'
import { handleBlocks, type BlocksAnswer, type BlocksRequest } from './blocksJob'
import type { Borders, ChunkMesh, Skin } from './mesh'

let worker: Worker | null = null
let broken = false
let nextId = 1
const waiting = new Map<number, { resolve: (a: BlocksAnswer) => void; req: BlocksRequest }>()

function inline(req: BlocksRequest): Promise<BlocksAnswer> {
  return Promise.resolve(handleBlocks(req).answer)
}

function getWorker(): Worker | null {
  if (broken || typeof Worker === 'undefined') return null
  if (worker) return worker
  try {
    const w = new Worker(new URL('../../workers/blocks.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (event: MessageEvent<BlocksAnswer>) => {
      const job = waiting.get(event.data.id)
      if (!job) return
      waiting.delete(event.data.id)
      job.resolve(event.data)
    }
    // A worker that fails gives every job back to the page, and the page does the rest itself.
    w.onerror = () => {
      broken = true
      if (worker === w) worker = null
      w.terminate()
      const jobs = [...waiting.values()]
      waiting.clear()
      for (const job of jobs) void inline(job.req).then(job.resolve)
    }
    worker = w
    return w
  } catch {
    broken = true
    return null
  }
}

function ask(req: BlocksRequest, transfer: Transferable[] = []): Promise<BlocksAnswer> {
  const w = getWorker()
  if (!w) return inline(req)
  return new Promise((resolve) => {
    waiting.set(req.id, { resolve, req })
    w.postMessage(req, transfer)
  })
}

/** A chunk's generated ground, and its family's skin ids (DECK ids). */
export async function generateChunk(base: ChunkBase): Promise<{ blocks: Uint8Array; top: number; rind: number }> {
  const a = await ask({ type: 'generate', id: nextId++, base })
  if (a.type === 'error') throw new Error(a.message)
  if (a.type !== 'generate') throw new Error('unexpected answer')
  return { blocks: a.blocks, top: a.top, rind: a.rind }
}

/** A chunk's mesh, from a copy of its blocks (the caller keeps its own). */
export async function meshChunkAsync(blocks: Uint8Array, borders: Borders, skin: Skin | null = null): Promise<ChunkMesh> {
  const copy = blocks.slice()
  const a = await ask({ type: 'mesh', id: nextId++, blocks: copy, borders, skin }, [copy.buffer])
  if (a.type === 'error') throw new Error(a.message)
  if (a.type !== 'mesh') throw new Error('unexpected answer')
  return a.mesh
}

/** Let the worker go: TERRAIN closed. Jobs still out are answered with an error: nobody wants them now, and redoing them here would stall the page. */
export function releaseBlocksWorker(): void {
  const w = worker
  worker = null
  if (!w) return
  w.terminate()
  const jobs = [...waiting.values()]
  waiting.clear()
  for (const job of jobs) job.resolve({ type: 'error', id: job.req.id, message: 'TERRAIN closed' })
}
