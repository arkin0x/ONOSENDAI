/**
 * avatar.worker.ts - mines an avatar's nonce off the main thread.
 *
 * One request per worker: chunks of nonces between progress messages, so the
 * elapsed time and the live rate are on screen while it runs. Several run at
 * once on disjoint residues of the nonce; the main thread takes the first
 * find and cancels by terminating them all (lib/avatarWorker.ts).
 */

import { mineChunk, type MineFound, type MineTemplate } from '../lib/avatarMine'

export interface MineRequest {
  template: MineTemplate
  target: number
  /** This worker's first nonce and the gap to its next: worker i of n takes i, i+n, i+2n... */
  start: number
  stride: number
}

export type MineResponse =
  | { type: 'progress'; tries: number; elapsedMs: number }
  | { type: 'done'; found: MineFound; tries: number; elapsedMs: number }

const CHUNK = 1024
const REPORT_MS = 200

self.onmessage = (event: MessageEvent<MineRequest>) => {
  const { template, target, start: first, stride } = event.data
  const start = performance.now()
  let tries = 0
  let lastReport = start
  for (;;) {
    const found = mineChunk(template, target, first + tries * stride, CHUNK, stride)
    if (found) {
      tries += Math.floor((Number(found.nonce) - first) / stride) % CHUNK + 1
      const done: MineResponse = { type: 'done', found, tries, elapsedMs: performance.now() - start }
      self.postMessage(done)
      return
    }
    tries += CHUNK
    const now = performance.now()
    if (now - lastReport >= REPORT_MS) {
      lastReport = now
      const progress: MineResponse = { type: 'progress', tries, elapsedMs: now - start }
      self.postMessage(progress)
    }
  }
}
