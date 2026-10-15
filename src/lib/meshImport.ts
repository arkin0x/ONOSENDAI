/**
 * meshImport.ts - IMPORT's way to the worker and back.
 *
 * The person picks one or more files (an OBJ with its MTL, a .gltf with its
 * .bin); they are checked for size before a byte is read, handed to
 * workers/meshImport.worker.ts, and the answer comes back as a shard ready to
 * put down, or a sentence. The worker is ended when it answers, and if it
 * has not answered by the deadline, so a file that defeats every check in
 * sno-core still cannot hold the workshop. Nothing here touches the network.
 */

import { IMPORT_MAX_FILE_BYTES, IMPORT_TIME_MS } from 'sno-core/mesh'
import { importMesh, type ImportFile, type ImportRequest, type ImportResponse } from 'sno-core/importFile'

/** The worker's own clock stops it at IMPORT_TIME_MS; this is the backstop past that. */
export const IMPORT_DEADLINE_MS = IMPORT_TIME_MS + 15_000

/** Files too large to read, refused before reading them; null when they may be read. */
export function tooLarge(files: Array<Pick<File, 'size'>>): string | null {
  const total = files.reduce((t, f) => t + f.size, 0)
  return total > IMPORT_MAX_FILE_BYTES
    ? `That is ${Math.round(total / 1048576)} MB. Import reads files of up to ${IMPORT_MAX_FILE_BYTES / 1048576} MB.`
    : null
}

/** The request, run in a worker; inline only where there is no Worker at all (the tests). */
export function runImport(request: ImportRequest, deadlineMs = IMPORT_DEADLINE_MS): Promise<ImportResponse> {
  if (typeof Worker === 'undefined') return Promise.resolve(importMesh(request))
  return new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('../workers/meshImport.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      // Not on the main thread instead: a large file there is exactly the freeze this avoids.
      resolve({ ok: false, error: 'This browser could not start the importer.' })
      return
    }
    let settled = false
    const settle = (answer: ImportResponse): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.terminate()
      resolve(answer)
    }
    const timer = setTimeout(() => settle({ ok: false, error: 'That file took too long to read. Try a smaller or simpler one.' }), deadlineMs)
    worker.onmessage = (message: MessageEvent<ImportResponse>) => settle(message.data)
    worker.onerror = (e) => { e.preventDefault(); settle({ ok: false, error: 'The importer stopped on that file. It may be damaged.' }) }
    const transfer = request.files.map((f) => f.bytes).filter((b): b is ArrayBuffer => b instanceof ArrayBuffer)
    worker.postMessage(request, transfer)
  })
}

/** Picked or dropped files, as a shard fitted by `options`, or why not. */
export async function importFiles(files: File[], options: ImportRequest['options']): Promise<ImportResponse> {
  if (files.length === 0) return { ok: false, error: 'No file was picked.' }
  const big = tooLarge(files)
  if (big) return { ok: false, error: big }
  let read: ImportFile[]
  try {
    read = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: await f.arrayBuffer() })))
  } catch {
    return { ok: false, error: 'That file could not be opened.' }
  }
  return runImport({ files: read, options })
}
