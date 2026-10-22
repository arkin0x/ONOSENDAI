/**
 * deployPlan.ts — where a hide's key gets computed, what it costs, how long.
 *
 * A hide at height h is sealed with the region key at h, which is three
 * Cantor axis trees of 2^h leaves. Below this machine's ceiling the key is
 * computed here, in the region worker. Above it, HOSAKA sells exactly this
 * key up to its hop cap (from /limits), at the price on its region key ladder
 * (regionKeyLadder), and the Cloud compute panel's mode says whether to ask
 * first: `auto` goes without asking up to its cap in sats (a cap of 0 asks
 * every time), `ask` always asks, `off` never leaves the machine, so the
 * ceiling stays local.
 *
 * Pure: the store hands in what it knows and gets a decision and two numbers.
 */

import { projectCantorMs, recommendedHopHeight } from './calibration'
import { parseEstTime } from './crossover'
import type { CloudMode } from './cloud'
import type { HosakaPriceTier, HosakaProvider } from './hosaka'

export type DeployRoute = 'local' | 'cloud'

/** The protocol's hard cap on what a client computes itself. */
export const LOCAL_KEY_HARD_CAP = 20

/**
 * This machine's limit, the same number the movement panel shows as its hop
 * limit: the calibrated ceiling, never past the protocol's cap of 20. A key
 * is a hop's work at that height, so a machine that hops to 17 hides to 17
 * on its own and asks HOSAKA above it; one limit, not two.
 */
export function localKeyCeiling(): number {
  return Math.min(LOCAL_KEY_HARD_CAP, recommendedHopHeight())
}

export interface DeployInputs {
  /** The highest height this machine computes itself. */
  localMax: number
  cloudMode: CloudMode
  /** HOSAKA's hop cap, from its published limits; null when unknown or off. */
  cloudCap: number | null
}

/** The highest height the deploy bar offers. */
export function deployCeiling(i: DeployInputs): number {
  if (i.cloudMode === 'off' || i.cloudCap === null) return i.localMax
  return Math.max(i.localMax, i.cloudCap)
}

/** Where the key for this height is computed. */
export function deployRoute(height: number, i: DeployInputs): DeployRoute {
  return height <= i.localMax ? 'local' : 'cloud'
}

/**
 * Seconds this machine needs for the key: three axes at the calibration's
 * measured or projected milliseconds per axis. Null before the benchmark ran.
 */
export function localKeySeconds(height: number, cantorMsByHeight: Record<number, number> | undefined): number | null {
  if (!cantorMsByHeight || Object.keys(cantorMsByHeight).length === 0) return null
  if (height <= 0) return 0
  const ms = projectCantorMs(cantorMsByHeight, height)
  return Number.isFinite(ms) ? (3 * ms) / 1000 : null
}

export interface CloudQuote {
  sats: number
  seconds: number | null
}

type Ladder = Array<Pick<HosakaPriceTier, 'max_height' | 'sats'> & Partial<Pick<HosakaPriceTier, 'est_time' | 'est_seconds'>>>

/**
 * The ladder a region key is priced from. A region key is not a hop of its
 * height: three trees and two composes, cheaper than the hop's rung at some
 * heights and dearer at others, so a provider that prices it on its own
 * publishes `pricing.region_key` (hosaka-api#30) and that is the ladder. A
 * provider that predates it has only the hop ladder, which is read as before.
 * A region key ladder that is present never falls back to the hop ladder for
 * a height it does not cover: that price is unknown, and an unknown price asks.
 */
export function regionKeyLadder(provider: Pick<HosakaProvider, 'pricing'> | null | undefined): Ladder | null {
  const own = provider?.pricing?.region_key
  if (Array.isArray(own) && own.length > 0) return own
  return provider?.pricing?.hop ?? null
}

/** HOSAKA's price and time for the key at this height, from its ladder. */
export function cloudKeyQuote(height: number, ladder: Ladder | null | undefined, experience = 1): CloudQuote | null {
  if (!ladder || ladder.length === 0) return null
  const band = [...ladder].sort((a, b) => a.max_height - b.max_height).find((b) => height <= b.max_height)
  if (!band) return null
  const seconds = typeof band.est_seconds === 'number' && band.est_seconds > 0 ? band.est_seconds : parseEstTime(band.est_time)
  // The provider's estimate, corrected by what its jobs have taken here.
  return { sats: band.sats, seconds: seconds === null ? null : seconds * experience }
}

/** HOSAKA's price and time for the region key at this height, from the provider's own region key ladder when it has one. */
export function regionKeyQuote(height: number, provider: Pick<HosakaProvider, 'pricing'> | null | undefined, experience = 1): CloudQuote | null {
  return cloudKeyQuote(height, regionKeyLadder(provider), experience)
}

/** Whether the Cloud compute mode wants a confirmation before this price. */
export function needsAsk(mode: CloudMode, sats: number | null, autoMaxSats: number): boolean {
  if (mode === 'ask') return true
  if (mode === 'auto') return autoMaxSats <= 0 || sats === null || sats > autoMaxSats
  return true
}

/** A wait, in words a bar can carry. */
export function waitLabel(seconds: number): string {
  if (seconds < 1) return 'under a second'
  if (seconds < 60) return `about ${Math.round(seconds)} s`
  if (seconds < 3600) return `about ${Math.round(seconds / 60)} min`
  return `about ${(seconds / 3600).toFixed(1)} h`
}
