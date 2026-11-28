/**
 * makeBlocksClient.test.ts - each blocks client has its own worker: one
 * client's release (TERRAIN closing) never answers another's jobs (TV's) with
 * an error. A stub Worker answers by the same code the real one runs.
 */
import { afterEach, expect, it } from 'vitest'
import { handleBlocks, type BlocksRequest } from '../blocksJob'
import { makeBlocksClient } from '../makeBlocksClient'

class StubWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  postMessage(req: BlocksRequest): void { setTimeout(() => this.onmessage?.({ data: handleBlocks(req).answer } as MessageEvent), 5) }
  terminate(): void { this.onmessage = null }
}
const had = (globalThis as { Worker?: unknown }).Worker
afterEach(() => { (globalThis as { Worker?: unknown }).Worker = had })

it('one client\'s release leaves the other\'s jobs alone', async () => {
  ;(globalThis as { Worker?: unknown }).Worker = StubWorker
  const field = makeBlocksClient(), tv = makeBlocksClient()
  const base = { x: 0x468ace02468ace024680n, y: 0x13579bdf13579bdf13560n, z: 0x0abcdef0abcdef0abce0n, plane: 0 }
  const fieldJob = field.generateChunk(base, 2)
  const tvJob = tv.generateChunk(base, 2)
  field.release('TERRAIN closed')
  await expect(fieldJob).rejects.toThrow('TERRAIN closed')
  expect((await tvJob).blocks.length).toBe(32768)
})
