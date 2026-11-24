/**
 * blocks.worker.ts - TERRAIN's ground off the main thread: a chunk generated
 * from public facts (lib/terrain/generate.ts), and a chunk's blocks greedily
 * meshed (lib/terrain/mesh.ts). Stateless; buffers go back transferred.
 */

import { handleBlocks, type BlocksRequest } from '../lib/terrain/blocksJob'

self.onmessage = (event: MessageEvent<BlocksRequest>): void => {
  const { answer, transfer } = handleBlocks(event.data)
  self.postMessage(answer, { transfer })
}
