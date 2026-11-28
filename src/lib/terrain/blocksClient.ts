/**
 * blocksClient.ts - asks the blocks worker for a chunk's ground, mesh or light.
 *
 * One worker, made the first time TERRAIN needs it and let go when TERRAIN
 * closes (releaseBlocksWorker), so nothing runs while you are not building.
 * Where no worker can start, or the one there fails, the same code runs here
 * on the page (lib/terrain/blocksJob.ts): slower for a frame, never wrong.
 */

import type { ChunkBase } from './coords'
import type { GroundRevision } from './generate'
import { handleBlocks, type BlocksAnswer, type BlocksRequest } from './blocksJob'
import type { Borders, ChunkMesh } from './mesh'

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
    // A worker that fails gives every job back to the page, and the page does the rest itself. A mesh or light job
    // handed the worker its blocks (transferred, so empty here now): it is answered with an error, and its caller
    // asks again, on the page this time.
    w.onerror = () => {
      broken = true
      if (worker === w) worker = null
      w.terminate()
      const jobs = [...waiting.values()]
      waiting.clear()
      for (const job of jobs) {
        if (job.req.type === 'generate') void inline(job.req).then(job.resolve)
        else job.resolve({ type: 'error', id: job.req.id, message: 'the blocks worker failed' })
      }
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

/** A chunk's generated ground at a revision (DECK-0009 §3.10; lib/terrain/groundRevision.ts), and its family's top and rind ids (DECK ids). */
export async function generateChunk(base: ChunkBase, revision: GroundRevision): Promise<{ blocks: Uint8Array; top: number; rind: number }> {
  const a = await ask({ type: 'generate', id: nextId++, base, revision })
  if (a.type === 'error') throw new Error(a.message)
  if (a.type !== 'generate') throw new Error('unexpected answer')
  return { blocks: a.blocks, top: a.top, rind: a.rind }
}

/** A chunk's mesh, from a copy of its blocks (the caller keeps its own). */
export async function meshChunkAsync(blocks: Uint8Array, borders: Borders): Promise<ChunkMesh> {
  const copy = blocks.slice()
  const a = await ask({ type: 'mesh', id: nextId++, blocks: copy, borders }, [copy.buffer])
  if (a.type === 'error') throw new Error(a.message)
  if (a.type !== 'mesh') throw new Error('unexpected answer')
  return a.mesh
}

/**
 * A chunk's light (light.ts computeLight): from copies of the chunk and its
 * 26 neighbours' blocks (null where open space), and which columns are open
 * above them.
 */
export async function lightChunkAsync(around: ReadonlyArray<Uint8Array | null>, skyTop: Uint8Array | null): Promise<Uint8Array<ArrayBuffer>> {
  const copies = around.map((b) => (b ? b.slice() : null))
  const top = skyTop ? skyTop.slice() : null
  const transfer: Transferable[] = []
  for (const b of copies) if (b) transfer.push(b.buffer)
  if (top) transfer.push(top.buffer)
  const a = await ask({ type: 'light', id: nextId++, around: copies, skyTop: top }, transfer)
  if (a.type === 'error') throw new Error(a.message)
  if (a.type !== 'light') throw new Error('unexpected answer')
  return a.light
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
