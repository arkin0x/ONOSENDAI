/**
 * WorldSeeds.tsx - the blooms of the seeds found in cyberspace (DECK-0008).
 *
 * A seed is an item in a bag; its bloom is never published, so every reader
 * grows it (store/useBlooms.ts) and draws it as a shard standing at the
 * seed's `C`, one model unit 2^scale gibsons (§5.6), with the same placement,
 * budget and tap target as any shard (WorldShards PlacedShard). Unlike a
 * shard it is never cut at its bag's cube: seeds hide at a findable height
 * (12 at most by default), and a bloom that grows past that cube is drawn
 * whole (owner ruling 2026-11-10: "I'm fine with blooms growing outside of
 * their height region because we want people to be able to find them"). Only
 * the seeds whose `C` names the view's plane are shown: one bag holds a
 * region and its twin in the other plane (spec §7.6 Planes).
 *
 * A seed whose bloom is not drawn yet (its DNA on its way, missing or
 * refused) stands as a small bead, so it can still be tapped for its card.
 */

import { useEffect, useMemo } from 'react'
import { GRID_RADIUS, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useCeremony } from '../store/useCeremony'
import { useShards, type WorldItem } from '../store/useShards'
import { useMutes } from '../store/useMutes'
import { useBlooms, wantSeeds } from '../store/useBlooms'
import { seedItemOf, seedsInPlane, type SeedItem } from '../lib/seeds/seedItem'
import { bloomShard } from '../lib/seeds/bloomShard'
import type { ShardModel } from 'sno-core/shards'
import type { NostrEvent } from '../lib/events'
import { PlacedShard, placeShard, useSteadied, type PlacedShardDraw } from './WorldShards'
import type { Box } from '../lib/clip'

const REACH = GRID_RADIUS * 8
/** A box that holds everything: a bloom is drawn whole, past its bag's cube (owner ruling 2026-11-10). */
const UNBOUNDED: Box = { min: [-Infinity, -Infinity, -Infinity], max: [Infinity, Infinity, Infinity] }
/**
 * The largest scale whose bloom draws past its cube. A bloom is held to 64
 * units of its own scale (DECK-0008 §3.8), so at 2^30 it reaches at most 2^36
 * gibsons; a seed at 2^84 (the spec allows it) from another client would cover
 * everything near it, and is cut at its cube instead.
 */
const UNCLIPPED_SCALE_MAX = 30

/** The bead a seed stands as before its bloom is drawn: half a unit across, the palette's green (index 168). */
function seedMark(unit: number): ShardModel {
  const r = 60
  const positions = new Int32Array([r, 0, 0, -r, 0, 0, 0, r, 0, 0, -r, 0, 0, 0, r, 0, 0, -r])
  const colors = new Uint8Array(6).fill(168)
  const faces = new Uint32Array([0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5])
  return bloomShard({ positions, colors, faces }, 'seed', unit, `seed-mark:${unit}`)
}
/** Seeds read once per event: the view moves every frame, and the tags do not. */
const read = new WeakMap<object, SeedItem | null>()
function seedOfEvent(ev: NostrEvent): SeedItem | null {
  let s = read.get(ev)
  if (s === undefined) read.set(ev, (s = seedItemOf(ev)))
  return s
}

const marks = new Map<number, ShardModel>()
function markFor(unit: number): ShardModel {
  let m = marks.get(unit)
  if (!m) marks.set(unit, (m = seedMark(unit)))
  return m
}

export function WorldSeeds({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const mine = useShards((s) => s.mine)
  const discovered = useShards((s) => s.discovered)
  const curated = useShards((s) => s.curated)
  const muted = useMutes((s) => s.muted)
  const births = useCeremony((s) => s.births)
  const views = useBlooms((s) => s.views)

  // The seeds in this plane and in reach, read with every check before their DNA (§8.2).
  const near = useMemo(() => {
    const origin = alignedOrigin(anchor, scaleExp)
    const out: Array<{ w: WorldItem; seed: SeedItem }> = []
    for (const w of seedsInPlane(useShards.getState().drawnItems(), anchorPlane)) {
      const seed = w.event ? seedOfEvent(w.event) : null
      if (!seed) continue
      const placed = placeShard({ ...w, shard: markFor(seed.scale) }, origin, scaleExp, axes)
      if (Number.isFinite(placed.scale) && Math.hypot(...placed.centre) <= REACH) out.push({ w, seed })
    }
    return out
    // mine, discovered, curated and muted are what drawnItems reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, anchorPlane, scaleExp, axes, mine, discovered, curated, muted])

  useEffect(() => { wantSeeds(near.map((n) => n.seed)) }, [near])

  const fresh = useMemo<PlacedShardDraw[]>(() => {
    const origin = alignedOrigin(anchor, scaleExp)
    return near.map(({ w, seed }) => {
      const placed = placeShard({ ...w, shard: views[seed.id]?.shard ?? markFor(seed.scale) }, origin, scaleExp, axes)
      // Past its cube only up to scale 2^30, the largest SEED offers: a seed at 2^84 from another client is cut at its cube as a shard is.
      return seed.scale <= UNCLIPPED_SCALE_MAX ? { ...placed, clip: UNBOUNDED } : placed
    })
  }, [near, views, anchor, scaleExp, axes])
  const placed = useSteadied(fresh)

  if (placed.length === 0) return null
  return <>{placed.map((w) => <PlacedShard key={w.key} w={w} birth={births[w.key]} occludes />)}</>
}
