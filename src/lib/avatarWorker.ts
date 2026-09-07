/**
 * avatarWorker.ts - the main thread's handle on an avatar mining job.
 *
 * `mineInWorker` starts a worker per spare core, each on its own residue of
 * the nonce, and resolves with the first find; cancel terminates them all and
 * rejects. The store takes any AvatarMiner of this shape, so tests run the
 * loop inline.
 */

import type { MineFound, MineTemplate } from './avatarMine'
import type { MineRequest, MineResponse } from '../workers/avatar.worker'

export interface MineProgress { tries: number; elapsedMs: number }

export interface MineJob {
  done: Promise<MineFound & MineProgress>
  cancel: () => void
}

export type AvatarMiner = (template: MineTemplate, target: number, onProgress: (p: MineProgress) => void) => MineJob

export class MineCancelled extends Error {
  constructor() { super('mining cancelled') }
}

/** Workers per job: every core but one, so the page itself keeps breathing. */
export function minerCount(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2
  return Math.max(1, Math.min(16, cores - 1))
}

export const mineInWorker: AvatarMiner = (template, target, onProgress) => {
  const workers: Worker[] = []
  const tries: number[] = []
  let elapsedMs = 0
  let settled = false
  let reject: (e: Error) => void = () => {}
  const stopAll = () => { for (const w of workers) w.terminate(); workers.length = 0 }
  const done = new Promise<MineFound & MineProgress>((resolve, rej) => {
    reject = rej
    const n = minerCount()
    for (let i = 0; i < n; i++) {
      let worker: Worker
      try {
        worker = new Worker(new URL('../workers/avatar.worker.ts', import.meta.url), { type: 'module' })
      } catch (e) {
        stopAll()
        settled = true
        rej(e instanceof Error ? e : new Error(String(e)))
        return
      }
      workers.push(worker)
      tries.push(0)
      worker.onmessage = (event: MessageEvent<MineResponse>) => {
        if (settled) return
        const msg = event.data
        tries[i] = msg.tries
        elapsedMs = Math.max(elapsedMs, msg.elapsedMs)
        const total = tries.reduce((a, b) => a + b, 0)
        if (msg.type === 'progress') { onProgress({ tries: total, elapsedMs }); return }
        settled = true
        stopAll()
        resolve({ ...msg.found, tries: total, elapsedMs })
      }
      worker.onerror = (e) => {
        if (settled) return
        settled = true
        stopAll()
        rej(new Error(e.message || 'mining failed'))
      }
      const request: MineRequest = { template, target, start: i, stride: n }
      worker.postMessage(request)
    }
  })
  return {
    done,
    cancel: () => {
      if (settled) return
      settled = true
      stopAll()
      reject(new MineCancelled())
    },
  }
}
