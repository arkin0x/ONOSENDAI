/**
 * useCoastline.ts - fetch-once access to the packed shorelines.
 *
 * Each tier is fetched at most once for the page's life and parsed off the
 * response; every caller after that gets the cached object synchronously.
 * A component asks for the tier its zoom deserves and draws nothing while
 * the bytes are still in flight, which at 40 KB to 3 MB from the app's own
 * origin is a moment, not a state worth UI.
 */
import { useEffect, useState } from 'react'
import { parseCoastline, type Coastline, type CoastTier } from '../lib/coastline'

const loaded = new Map<CoastTier, Coastline>()
const inFlight = new Map<CoastTier, Promise<Coastline>>()

function load(tier: CoastTier): Promise<Coastline> {
  const done = loaded.get(tier)
  if (done) return Promise.resolve(done)
  let p = inFlight.get(tier)
  if (!p) {
    p = fetch(`/coastline-${tier}.bin`)
      .then((r) => {
        if (!r.ok) throw new Error(`coastline ${tier}: HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then((buf) => {
        const c = parseCoastline(buf)
        loaded.set(tier, c)
        inFlight.delete(tier)
        return c
      })
    inFlight.set(tier, p)
  }
  return p
}

/** The parsed tier, or null while it loads (or if it cannot). */
export function useCoastline(tier: CoastTier | null): Coastline | null {
  const [, bump] = useState(0)
  useEffect(() => {
    if (tier === null || loaded.has(tier)) return
    let alive = true
    load(tier).then(() => { if (alive) bump((n) => n + 1) }).catch(() => {})
    return () => { alive = false }
  }, [tier])
  return tier !== null ? loaded.get(tier) ?? null : null
}
