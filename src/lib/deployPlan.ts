/**
 * deployPlan.ts — where a hide's key gets computed, what it costs, how long.
 *
 * A hide at height h is sealed with the region key at h, which is three
 * Cantor axis trees of 2^h leaves: a hop's work at that height. Below this
 * machine's ceiling the key is computed here, in the region worker. Above it,
 * HOSAKA sells exactly this key at its hop cap, and the Cloud compute panel's
 * mode says whether to ask first: `auto` goes without asking up to its cap in
 * sats (a cap of 0 asks every time), `ask` always asks, `off` never leaves the
 * machine, so the ceiling stays local.
 *
 * Pure: the store hands in what it knows and gets a decision and two numbers.
 */

import { projectCantorMs } from './calibration'
import { parseEstTime } from './crossover'
import type { CloudMode } from './cloud'

export type DeployRoute = 'local' | 'cloud'

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

/** HOSAKA's price and time for the key at this height, from its ladder. */
export function cloudKeyQuote(height: number, ladder: Array<{ max_height: number; sats: number; est_time?: string; est_seconds?: number | null }> | null | undefined): CloudQuote | null {
  if (!ladder || ladder.length === 0) return null
  const band = [...ladder].sort((a, b) => a.max_height - b.max_height).find((b) => height <= b.max_height)
  if (!band) return null
  const seconds = typeof band.est_seconds === 'number' && band.est_seconds > 0 ? band.est_seconds : parseEstTime(band.est_time)
  return { sats: band.sats, seconds }
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
