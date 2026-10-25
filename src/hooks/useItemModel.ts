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

import { useEffect, useState } from 'react'
import { flatten, fromPayload, type ShardModel } from 'sno-core/shards'
import { parseAddress, placedBounds, resolveParts, type Placed } from 'sno-core/parts'
import { keepOwnTable } from '../lib/carried'
import { fetchRef } from '../lib/parts'
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

/** The model at `address` from its payload (parsed JSON), measured, or null when it is not one. */
export async function modelFromPayload(address: string, payload: unknown): Promise<LoadedModel | null> {
  const read = payload == null ? null : fromPayload(payload, address)
  // What it carries counts only under the pubkey its address names (DECK-0003 §1.10).
  const shard = read && keepOwnTable(read, parseAddress(address)?.pubkey)
  if (!shard) return null
  let placed: Placed[] = []
  if (shard.refs?.length && shard.parts?.length) {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), PARTS_WAIT_MS))
    placed = (await Promise.race([resolveParts(shard, fetchRef).catch(() => null), timeout])) ?? []
  }
  const parts = shard.parts?.length ? placedBounds({ ...shard, vertices: [] }, placed) : null
  const extent = extentOf(flatten(shard).positions, parts)
  return extent ? { shard, extent } : null
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
  useEffect(() => {
    if (!address) { setModel(null); return }
    const now = loadedItemModel(address)
    if (now) { setModel(now); return }
    setModel(null)
    let live = true
    void loadItemModel({ address, ...(relay ? { relay } : {}) }).then((m) => { if (live) setModel(m) })
    return () => { live = false }
  }, [address, relay])
  return model
}
