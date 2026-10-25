/**
 * useItemModel.ts: the SNO an item wears, fetched once for the whole app
 * (lib/itemModel.ts says what the tag is).
 *
 * The object comes through lib/parts.ts fetchRef, the one cache every placed
 * object is fetched through, so an item wearing a column the world already
 * drew asks no relay again. Parsed once per address and measured once
 * (extentOf), so ten items wearing one model share one ShardModel and one
 * extent, and a frame never measures anything.
 *
 * Until it arrives, and when it cannot (no relay has it, it is sealed, it
 * does not parse), the item is drawn as the note's cube, as it always was.
 * A miss is not remembered: the next item to mount asks again, as fetchRef
 * does, since a relay that was slow a moment ago may answer now.
 */

import { useEffect, useRef, useState } from 'react'
import { flatten, fromPayload, type ShardModel } from 'sno-core/shards'
import { placedBounds, resolveParts, type Placed } from 'sno-core/parts'
import { fetchRef, onLocalObjects, touchedKeys } from '../lib/parts'
import { extentOf, type ItemModelRef, type ModelExtent } from '../lib/itemModel'

/** A model, ready to draw: the shard and how far it reaches about its centre. */
export interface LoadedModel {
  shard: ShardModel
  extent: ModelExtent
}

/** How long an object that places others waits for its parts before it is measured without them. */
const PARTS_WAIT_MS = 8000

const loading = new Map<string, Promise<LoadedModel | null>>()
const loaded = new Map<string, LoadedModel>()
/** Every reference a model was measured with, its own and its parts' at any depth (lib/parts.ts refKey). */
const touches = new WeakMap<LoadedModel, Set<string>>()
/** Mounted items, told when the model at an address must be loaded again. */
const reloads = new Set<(address: string) => void>()

// One of your own objects edited in the workshop (store/localObjects.ts): an
// item wearing it, or wearing anything that places it, is measured again, and
// every item mounted with it now loads the new one. One still loading may
// place it deeper down than is known yet, so it loads again too.
onLocalObjects((changed) => {
  const stale = new Set<string>()
  for (const address of loading.keys()) {
    const m = loaded.get(address)
    const keys = m ? touches.get(m) : undefined
    if (!keys) { stale.add(address); continue }
    for (const c of changed) if (keys.has(c)) { stale.add(address); break }
  }
  for (const address of stale) forgetItemModel(address)
  for (const address of stale) for (const r of reloads) r(address)
})

/** The model at `address` from its payload (parsed JSON), measured, or null when it is not one. */
export async function modelFromPayload(address: string, payload: unknown): Promise<LoadedModel | null> {
  const shard = payload == null ? null : fromPayload(payload, address)
  if (!shard) return null
  let placed: Placed[] = []
  if (shard.refs?.length && shard.parts?.length) {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), PARTS_WAIT_MS))
    placed = (await Promise.race([resolveParts(shard, fetchRef).catch(() => null), timeout])) ?? []
  }
  const parts = shard.parts?.length ? placedBounds({ ...shard, vertices: [] }, placed) : null
  const extent = extentOf(flatten(shard).positions, parts)
  if (!extent) return null
  const model = { shard, extent }
  touches.set(model, touchedKeys(placed, new Set([`a:${address}`, ...(shard.refs ?? []).map((r) => `${r[0]}:${r[1]}`)])))
  return model
}

/** Fetch and measure a model, once per address while it is wanted. */
export function loadItemModel(ref: ItemModelRef): Promise<LoadedModel | null> {
  const held = loading.get(ref.address)
  if (held) return held
  const got = fetchRef(ref.relay ? ['a', ref.address, ref.relay] : ['a', ref.address]).then((p) => modelFromPayload(ref.address, p)).catch(() => null)
  loading.set(ref.address, got)
  void got.then((m) => {
    if (m) loaded.set(ref.address, m)
    else if (loading.get(ref.address) === got) loading.delete(ref.address)
  })
  return got
}

/** A model already in hand, without waiting. */
export function loadedItemModel(address: string): LoadedModel | null {
  return loaded.get(address) ?? null
}

/** Drop a model, so the next draw fetches it again: for tests, and after its author publishes a new version. */
export function forgetItemModel(address: string): void {
  loading.delete(address)
  loaded.delete(address)
}

/**
 * The model an item wears, or null while it loads, when it failed, and when
 * the item wears none: in every one of those the caller draws the cube.
 */
export function useItemModel(ref: ItemModelRef | undefined | null): LoadedModel | null {
  const address = ref?.address ?? null
  const relay = ref?.relay
  const [model, setModel] = useState<LoadedModel | null>(() => (address ? loadedItemModel(address) : null))
  // Bumped when the model at this address must be loaded again (an edit of yours it wears or places).
  const [again, setAgain] = useState(0)
  useEffect(() => {
    if (!address) return
    const r = (a: string): void => { if (a === address) setAgain((n) => n + 1) }
    reloads.add(r)
    return () => { reloads.delete(r) }
  }, [address])
  // The address the model on show was loaded for: a reload keeps it up until the new one is measured.
  const shown = useRef(address)
  useEffect(() => {
    if (!address) { setModel(null); return }
    const now = loadedItemModel(address)
    if (now) { setModel(now); shown.current = address; return }
    if (shown.current !== address) { setModel(null); shown.current = address }
    let live = true
    void loadItemModel({ address, ...(relay ? { relay } : {}) }).then((m) => { if (live) setModel(m) })
    return () => { live = false }
  }, [address, relay, again])
  return model
}
