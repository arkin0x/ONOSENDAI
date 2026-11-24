/**
 * blockImport.worker.ts - a block build (.schem, .litematic, structure .nbt)
 * read and built into shards off the main thread (lib/blocks/blockSession.ts).
 *
 * The file is read once and kept here; each build answers with its plan and
 * triangles to preview (their buffers moved, not copied), and the shards of
 * the last build go to the workshop only when SAVE TO WORKSHOP asks for them.
 */

import { BlockSteps, answer, type WorkerRequest } from '../lib/blocks/blockSession'

const steps = new BlockSteps()

self.onmessage = async (message: MessageEvent<WorkerRequest>): Promise<void> => {
  const reply = await answer(steps, message.data)
  const transfer: Transferable[] = []
  if (reply.ok && 'plan' in reply) for (const p of reply.plan.preview) transfer.push(p.positions.buffer, p.colors.buffer)
  ;(self as unknown as Worker).postMessage(reply, transfer)
}
