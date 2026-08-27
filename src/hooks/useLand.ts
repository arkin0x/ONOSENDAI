/**
 * useLand.ts - fetch-once access to the packed land polygons.
 *
 * The same shape as useCoastline, for the same reason: a tier is fetched at
 * most once for the page's life and every caller after that gets the parsed
 * mesh synchronously. The tiers are small (41 KB and 700 KB against the
 * shorelines' 3 MB at 10m) because the fill stops at 50m, so there is never
 * a moment worth showing UI for.
 */
import { useEffect, useState } from 'react'
import { parseLand, type LandMesh, type LandTier } from '../lib/land'

const loaded = new Map<LandTier, LandMesh>()
const inFlight = new Map<LandTier, Promise<LandMesh>>()

function load(tier: LandTier): Promise<LandMesh> {
  const done = loaded.get(tier)
  if (done) return Promise.resolve(done)
  let p = inFlight.get(tier)
  if (!p) {
    p = fetch(`/land-${tier}.bin`)
      .then((r) => {
        if (!r.ok) throw new Error(`land ${tier}: HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then((buf) => {
        const m = parseLand(buf)
        loaded.set(tier, m)
        inFlight.delete(tier)
        return m
      })
    inFlight.set(tier, p)
  }
  return p
}

/** The parsed tier, or null while it loads (or if it cannot). */
export function useLand(tier: LandTier | null): LandMesh | null {
  const [, bump] = useState(0)
  useEffect(() => {
    if (tier === null || loaded.has(tier)) return
    let alive = true
    load(tier).then(() => { if (alive) bump((n) => n + 1) }).catch(() => {})
    return () => { alive = false }
  }, [tier])
  return tier !== null ? loaded.get(tier) ?? null : null
}
