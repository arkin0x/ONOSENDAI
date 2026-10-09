/**
 * meshImport.worker.ts - a 3D file made into a shard off the main thread.
 *
 * A file is untrusted and can be large: a 50 MB scan parsed on the main
 * thread would freeze the workshop until it finished. Here it is read,
 * fitted and simplified by sno-core's importMesh, which never throws and
 * answers with a shard or one sentence (sno-core importFile). lib/meshImport
 * ends this worker if it has not answered by its deadline.
 */

import { importMesh, type ImportRequest, type ImportResponse } from 'sno-core/importFile'

self.onmessage = (message: MessageEvent<ImportRequest>): void => {
  const answer: ImportResponse = importMesh(message.data)
  self.postMessage(answer)
}
