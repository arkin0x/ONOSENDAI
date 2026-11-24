/**
 * blockSession.ts: one block file being imported, read once and built as
 * often as the person changes a choice, off the main thread.
 *
 * The file is read in workers/blockImport.worker.ts and kept there: a
 * castle's grid is a few megabytes, and the workshop never needs it, only
 * what it becomes. Each change of colour, region, decoration or scale asks
 * the worker to build again and answers with the plan (how many pieces, how
 * full) and triangles to preview; SAVE TO WORKSHOP asks for the shards of
 * the last build. Every request has the import's deadline (IMPORT_TIME_MS
 * and a backstop, as lib/meshImport.ts), past which the worker is ended and
 * the session says so. Nothing here touches the network.
 *
 * Where there is no Worker at all (the tests), the same steps run inline.
 */

import { IMPORT_MAX_FILE_BYTES, IMPORT_TIME_MS, MeshImportError, makeClock } from 'sno-core/mesh'
import { BlockImportError, gridBounds, stateCounts, type BlockFormat, type BlockGrid, type V3 } from './blockGrid'
import { buildImport, parentOf, type BlockUnit, type BuildResult, type BuiltObject, type PreviewLayer } from './blockBuild'
import { sizeHeight } from '../deployFit'
import { lookOf, type BlockLook, type ColourChoices, type Layer } from './colourTable'
import { readBlockFile } from './readBlockFile'

/** The worker's own clock stops it at IMPORT_TIME_MS; this is the backstop past that. */
export const BLOCK_DEADLINE_MS = IMPORT_TIME_MS + 15_000

/** One block state found in the file, for the colour list. */
export interface FoundState {
  /** The state as the file names it ("from your file"). */
  state: string
  count: number
  look: BlockLook
}

/** What the file holds, for the importer's first screen. */
export interface BlockSummary {
  name: string
  format: BlockFormat
  size: V3
  regions: Array<{ name: string; size: V3; blocks: number }>
  /** Every state with blocks in it, the most used first. Air is left out. */
  states: FoundState[]
}

export interface BuildRequest {
  include?: number[]
  choices: ColourChoices
  unit: BlockUnit
  budget: number
}

/** A build's plan: everything but the shards themselves, which stay in the worker until saved. */
export interface BuildPlan {
  name: string
  size: V3
  blocks: number
  rects: number
  single: boolean
  unit: BlockUnit
  /** The smallest height BUILD hides it at, as lib/deployFit.ts sizes it. */
  height: number
  objects: Array<{ layer: Layer; name: string; bytes: number; rects: number }>
  preview: PreviewLayer[]
}

type Ask =
  | { type: 'open'; name: string; bytes: ArrayBuffer }
  | { type: 'build'; request: BuildRequest }
  | { type: 'take' }
export type WorkerRequest = Ask & { id: number }

export type WorkerAnswer =
  | { id: number; ok: true; summary: BlockSummary }
  | { id: number; ok: true; plan: BuildPlan }
  | { id: number; ok: true; objects: BuiltObject[] }
  | { id: number; ok: false; error: string }

/** The steps themselves, kept by whoever runs them: the worker, or the session inline. */
export class BlockSteps {
  private grid: BlockGrid | null = null
  private looks: BlockLook[] = []
  private last: BuildResult | null = null

  async open(name: string, bytes: Uint8Array): Promise<BlockSummary> {
    this.grid = null
    this.last = null
    const grid = await readBlockFile(name, bytes, makeClock(IMPORT_TIME_MS))
    this.grid = grid
    this.looks = grid.palette.map(lookOf)
    const counts = stateCounts(grid)
    const states: FoundState[] = []
    grid.palette.forEach((state, i) => { if (counts[i] > 0) states.push({ state, count: counts[i], look: this.looks[i] }) })
    states.sort((a, b) => b.count - a.count || a.state.localeCompare(b.state))
    return {
      name: grid.name,
      format: grid.format,
      size: gridBounds(grid).size,
      regions: grid.regions.map((r) => ({ name: r.name, size: r.size, blocks: r.cells.reduce((n, c) => (c ? n + 1 : n), 0) })),
      states,
    }
  }

  build(request: BuildRequest): BuildPlan {
    if (!this.grid) throw new BlockImportError('Pick a file first.')
    this.last = null
    let r: BuildResult
    try {
      r = buildImport(this.grid, { ...request, looks: this.looks }, makeClock(IMPORT_TIME_MS))
    } catch (e) {
      if (e instanceof MeshImportError) throw new BlockImportError('That build took too long to make. Turn on MERGE SIMILAR, or save a smaller part of it.')
      throw e
    }
    this.last = r
    // Sized as BUILD sizes it: the build, or the parent that places its pieces (any key: only anchors count).
    const height = sizeHeight(r.single ? r.objects[0].shard : parentOf(r, '0'.repeat(64)), r.unit)
    return {
      name: r.name, size: r.size, blocks: r.blocks, rects: r.rects, single: r.single, unit: r.unit, height,
      objects: r.objects.map((o) => ({ layer: o.layer, name: o.shard.name, bytes: o.bytes, rects: o.rects })),
      preview: r.preview,
    }
  }

  take(): BuiltObject[] {
    if (!this.last) throw new BlockImportError('Nothing is built yet.')
    return this.last.objects
  }
}

/** Any failure as one sentence for the person. */
export function sentence(e: unknown): string {
  if (e instanceof BlockImportError || e instanceof MeshImportError) return e.message
  if (e instanceof RangeError) return 'That build is too large to read in this browser.'
  return 'That file could not be read. It may be damaged, or a kind of build import does not know.'
}

/** Answers one request; the worker's whole job. */
export async function answer(steps: BlockSteps, req: WorkerRequest): Promise<WorkerAnswer> {
  try {
    switch (req.type) {
      case 'open': return { id: req.id, ok: true, summary: await steps.open(req.name, new Uint8Array(req.bytes)) }
      case 'build': return { id: req.id, ok: true, plan: steps.build(req.request) }
      case 'take': return { id: req.id, ok: true, objects: steps.take() }
    }
  } catch (e) {
    return { id: req.id, ok: false, error: sentence(e) }
  }
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

/** A file being imported: open it, build it as often as asked, take its shards. */
export class BlockSession {
  private worker: Worker | null = null
  private inline: BlockSteps | null = null
  private next = 1
  private waiting = new Map<number, { resolve: (a: WorkerAnswer) => void; timer: ReturnType<typeof setTimeout> }>()
  private dead = false

  constructor(private readonly deadlineMs = BLOCK_DEADLINE_MS) {
    if (typeof Worker === 'undefined') { this.inline = new BlockSteps(); return }
    try {
      this.worker = new Worker(new URL('../../workers/blockImport.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (m: MessageEvent<WorkerAnswer>) => this.settle(m.data)
      this.worker.onerror = (e) => { e.preventDefault(); this.fail('The importer stopped on that file. It may be damaged.') }
    } catch {
      this.dead = true
    }
  }

  private settle(a: WorkerAnswer): void {
    const w = this.waiting.get(a.id)
    if (!w) return
    clearTimeout(w.timer)
    this.waiting.delete(a.id)
    w.resolve(a)
  }

  /** Every request still waiting answered with `error`, and the worker ended: a session that failed this way is over. */
  private fail(error: string): void {
    this.dead = true
    this.worker?.terminate()
    this.worker = null
    for (const [id, w] of this.waiting) { clearTimeout(w.timer); w.resolve({ id, ok: false, error }) }
    this.waiting.clear()
  }

  private ask(req: Ask, transfer: Transferable[] = []): Promise<WorkerAnswer> {
    const id = this.next++
    const full = { ...req, id } as WorkerRequest
    if (this.inline) return answer(this.inline, full)
    if (this.dead || !this.worker) return Promise.resolve({ id, ok: false, error: 'This browser could not start the importer.' })
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.fail('That build took too long. Try a smaller part of it, or turn on MERGE SIMILAR.'), this.deadlineMs)
      this.waiting.set(id, { resolve, timer })
      this.worker!.postMessage(full, transfer)
    })
  }

  /** Read a picked or dropped file: what it holds, or why not. */
  async open(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>): Promise<Result<BlockSummary>> {
    if (file.size > IMPORT_MAX_FILE_BYTES) return { ok: false, error: `That is ${Math.round(file.size / 1048576)} MB. Import reads files of up to ${IMPORT_MAX_FILE_BYTES / 1048576} MB.` }
    let bytes: ArrayBuffer
    try { bytes = await file.arrayBuffer() } catch { return { ok: false, error: 'That file could not be opened.' } }
    const a = await this.ask({ type: 'open', name: file.name, bytes }, [bytes])
    return a.ok && 'summary' in a ? { ok: true, value: a.summary } : { ok: false, error: a.ok ? 'The importer answered something else.' : a.error }
  }

  async build(request: BuildRequest): Promise<Result<BuildPlan>> {
    const a = await this.ask({ type: 'build', request })
    return a.ok && 'plan' in a ? { ok: true, value: a.plan } : { ok: false, error: a.ok ? 'The importer answered something else.' : a.error }
  }

  /** The shards of the last build: the build itself, or its pieces in order. */
  async take(): Promise<Result<BuiltObject[]>> {
    const a = await this.ask({ type: 'take' })
    return a.ok && 'objects' in a ? { ok: true, value: a.objects } : { ok: false, error: a.ok ? 'The importer answered something else.' : a.error }
  }

  close(): void {
    this.fail('Closed.')
    this.inline = null
  }
}
