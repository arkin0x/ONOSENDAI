/**
 * placedBuffers.ts: one set of geometry for every placement of one object.
 *
 * A placed object's geometry depends on the object alone. It is not cut to a
 * region and not posed, because its place is a transform on the group above it.
 * Yet each placement built all of it again, in its JS arrays and its GL buffers,
 * with normals computed each time. An object placed a thousand times held a
 * thousand copies, and landing among them built a thousand copies on the main
 * thread.
 *
 * What a scene draws is budgeted in placed objects (meshBudget.ts), and your own
 * shards and those of authors you follow have a share of 2,000 on top of the
 * strangers' 1,000. So your own scene is the one this hits hardest. A test key
 * viewing the same spot sees everything as a stranger's, under a limit of 250 per
 * shard, which is one reason it did not reproduce his memory here.
 *
 * Shared, a placement costs its own transform, materials and draw calls.
 * Nothing here is written after it is built: a placement that decodes or
 * dissolves keeps a copy of its own (ShardMesh).
 */

import type { BufferGeometry } from 'three'

/** What ShardMesh draws an object from. Read only, once built. */
export interface PlacedBuffers<S = unknown> {
  shard: S
  positions: Float32Array
  colors: Float32Array
  index: number[]
  faces: number[][]
  drawn: number[]
  plain: BufferGeometry
  indexed: BufferGeometry
  outline: BufferGeometry | null
  /** Only a lit draw has insides, so it is made the first time one asks. */
  inside: () => BufferGeometry
  /** Every geometry made so far, to let go together. */
  geometries: () => BufferGeometry[]
}

interface Entry<S> {
  buffers: PlacedBuffers<S>
  holders: number
  released: boolean
}

const entries = new WeakMap<object, Entry<unknown>>()

/** The object's buffers, made the first time anything asks. Safe in a render: nothing is held until `holdPlaced`. */
export function placedBuffers<S>(model: object, make: () => PlacedBuffers<S>): PlacedBuffers<S> {
  let e = entries.get(model) as Entry<S> | undefined
  if (!e) {
    e = { buffers: make(), holders: 0, released: false }
    entries.set(model, e as Entry<unknown>)
  }
  return e.buffers
}

/**
 * One placement is drawing the object; the return says it has stopped. When the
 * last one stops and none has come by the next task, the GPU buffers and the
 * arrays go. Not at once: a commit that replaces one placement with another runs
 * every cleanup before every new effect.
 */
export function holdPlaced(model: object, buffers: PlacedBuffers<unknown>): () => void {
  let e = entries.get(model)
  // Let go between its render and this effect: the same buffers come back, or they would be drawn unowned.
  if (!e || e.buffers !== buffers) {
    e = { buffers, holders: 0, released: false }
    entries.set(model, e)
  }
  const entry = e
  entry.holders++
  return () => {
    entry.holders--
    setTimeout(() => {
      if (entry.holders > 0 || entry.released) return
      entry.released = true
      if (entries.get(model) === entry) entries.delete(model)
      for (const g of entry.buffers.geometries()) g.dispose()
    }, 0)
  }
}
