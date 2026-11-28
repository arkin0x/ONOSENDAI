/**
 * makeBlocksClient.ts - a client of its own for the blocks worker
 * (workers/blocks.worker.ts): a chunk's ground, mesh or light.
 *
 * Each client starts its own worker the first time it is asked, and lets it
 * go on release(), so one owner's release never cancels another's jobs.
 * TERRAIN's field uses the one in lib/terrain/blocksClient.ts; Cyberspace
 * TV's terrain (store/useTvTerrain.ts) has its own, let go when TV ends.
 * Where no worker can start, or the one there fails, the same code runs on
 * the page (lib/terrain/blocksJob.ts): slower for a frame, never wrong.
 */

import type { ChunkBase } from './coords'
import type { GroundRevision } from './generate'
import { handleBlocks, type BlocksAnswer, type BlocksRequest } from './blocksJob'
import type { Borders, ChunkMesh } from './mesh'

export interface GroundAnswer { blocks: Uint8Array; top: number; rind: number; family: string; maxK: number; meanK: number }

export interface BlocksClient {
  /** A chunk's generated ground at a revision (DECK-0009 §3.10), its family's top and rind ids, and its family and terrain K. */
  generateChunk: (base: ChunkBase, revision: GroundRevision) => Promise<GroundAnswer>
  /** A chunk's mesh, from a copy of its blocks (the caller keeps its own). */
  meshChunkAsync: (blocks: Uint8Array, borders: Borders) => Promise<ChunkMesh>
  /** A chunk's light (light.ts computeLight), from copies of the chunk and its 26 neighbours' blocks, and its open columns. */
  lightChunkAsync: (around: ReadonlyArray<Uint8Array | null>, skyTop: Uint8Array | null) => Promise<Uint8Array<ArrayBuffer>>
  /** Let the worker go. Jobs still out are answered with an error carrying `why`. */
  release: (why: string) => void
}

export function makeBlocksClient(): BlocksClient {
  let worker: Worker | null = null
  let broken = false
  let nextId = 1
  const waiting = new Map<number, { resolve: (a: BlocksAnswer) => void; req: BlocksRequest }>()

  const inline = (req: BlocksRequest): Promise<BlocksAnswer> => Promise.resolve(handleBlocks(req).answer)

  const getWorker = (): Worker | null => {
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

  const ask = (req: BlocksRequest, transfer: Transferable[] = []): Promise<BlocksAnswer> => {
    const w = getWorker()
    if (!w) return inline(req)
    return new Promise((resolve) => {
      waiting.set(req.id, { resolve, req })
      w.postMessage(req, transfer)
    })
  }

  return {
    async generateChunk(base, revision) {
      const a = await ask({ type: 'generate', id: nextId++, base, revision })
      if (a.type === 'error') throw new Error(a.message)
      if (a.type !== 'generate') throw new Error('unexpected answer')
      return { blocks: a.blocks, top: a.top, rind: a.rind, family: a.family, maxK: a.maxK, meanK: a.meanK }
    },
    async meshChunkAsync(blocks, borders) {
      const copy = blocks.slice()
      const a = await ask({ type: 'mesh', id: nextId++, blocks: copy, borders }, [copy.buffer])
      if (a.type === 'error') throw new Error(a.message)
      if (a.type !== 'mesh') throw new Error('unexpected answer')
      return a.mesh
    },
    async lightChunkAsync(around, skyTop) {
      const copies = around.map((b) => (b ? b.slice() : null))
      const top = skyTop ? skyTop.slice() : null
      const transfer: Transferable[] = []
      for (const b of copies) if (b) transfer.push(b.buffer)
      if (top) transfer.push(top.buffer)
      const a = await ask({ type: 'light', id: nextId++, around: copies, skyTop: top }, transfer)
      if (a.type === 'error') throw new Error(a.message)
      if (a.type !== 'light') throw new Error('unexpected answer')
      return a.light
    },
    release(why) {
      const w = worker
      worker = null
      if (!w) return
      w.terminate()
      const jobs = [...waiting.values()]
      waiting.clear()
      for (const job of jobs) job.resolve({ type: 'error', id: job.req.id, message: why })
    },
  }
}
