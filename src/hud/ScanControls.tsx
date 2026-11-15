/**
 * ScanControls.tsx - SCAN mode's height and its SCAN button (arkinox,
 * 2026-11-14): "The height controls for scan can go on the left side where
 * the fly forward and backward buttons are for VIEW mode. I imagine the
 * height buttons would be much like the floor up and down buttons in the
 * workshop. Except I think it should say scan height x." and "some sort of
 * button that lets you initiate the scan once you've chosen the height.
 * Maybe that button is to the right of the height up and down buttons that
 * are styled like the view fly buttons and it says scan."
 *
 * Where VIEW's fly buttons stand (and in their dock, `.flyorbs`, so every
 * rule that moves them moves these too: the HOSAKA mark, a phone on its
 * side, the chat): the workshop rail's up, value and down (workshop/shell/
 * Rail.tsx), reading SCAN HEIGHT and the height, and to their right a glass
 * orb like the fly buttons, in purple, that says SCAN. Under the height a line
 * says how long a scan at that height takes (arkinox, 2026-11-15: "Can you
 * make them say a time estimate in white text for how long that height will
 * take to scan?"): from this device's benchmark up to its max, HOSAKA's own
 * estimate and its price above it, INSTANT for a cube already held, which is
 * only asked about again (store/useScan.ts scanSeconds). Both lines are white
 * with a dark edge, readable over the brightest scene; the price, or DEVICE
 * MAX, on a line of its own, so the dock never widens. While
 * a scan runs the orb is CANCEL and a line under the controls says how far
 * along it is; then what it found. A HOSAKA height the Cloud compute mode
 * asks about (ASK, or AUTO over its cap) takes two presses: the first arms
 * CONFIRM with the price, the second pays (store/useScan.ts). A HOSAKA scan
 * paid for has no CANCEL: it finishes, and the key is held as bought.
 */

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import { useSecrets } from '../store/useSecrets'
import { scanCancellable, scanPrice, scanSeconds, useScan, type ScanJob, type ScanResult } from '../store/useScan'
import { useCalibration } from '../lib/calibration'
import { ratioOf, useExperience } from '../lib/experience'
import { localKeyCeiling } from '../lib/deployPlan'
import { heldCube, scanRange, SCAN_MIN_HEIGHT, type ScanRange } from '../lib/scanCube'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import type { CloudStatus } from '../store/useCyberspace'

/**
 * A wait in plain words, rounded the way a person would say it: under a
 * second, seconds to 10 then fives, minutes to 10 then fives, hours to 10
 * then fives, days.
 */
export function scanTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'TIME UNKNOWN'
  if (seconds < 1) return 'UNDER 1 SEC'
  const say = (n: number, unit: string): string => `ABOUT ${n} ${unit}`
  // Fives past 10, and a count that would round up to the next unit says that unit.
  const round = (n: number): number => (n < 9.5 ? Math.max(1, Math.round(n)) : Math.round(n / 5) * 5)
  if (seconds < 57.5) return say(round(seconds), 'SEC')
  const minutes = seconds / 60
  if (minutes < 57.5) return say(round(minutes), 'MIN')
  const hours = minutes / 60
  if (hours < 22.5) return say(round(hours), 'HR')
  const days = Math.round(hours / 24)
  return days > 99 ? 'OVER 99 DAYS' : say(days, days === 1 ? 'DAY' : 'DAYS')
}

/**
 * The words under the height, a line each: how long a scan there takes. A
 * cube already held is INSTANT (only the relays are asked); a HOSAKA height
 * says its price too, always; the device max with nothing past it says so.
 */
export function scanTagLines(height: number, range: ScanRange, held: boolean, price: number | null, seconds: number | null): string[] {
  if (held) return ['INSTANT']
  const time = seconds === null ? null : scanTime(seconds)
  if (height <= range.localMax) {
    const local = time ?? 'TIME UNKNOWN'
    return height === range.top && !range.cloud ? [local, 'DEVICE MAX'] : [local]
  }
  return [time ?? 'HOSAKA', price === null ? 'NO PRICE YET' : `${price} SATS`]
}

/** The same words on one line: the tooltip, and what the tests read. */
export function scanTag(height: number, range: ScanRange, held: boolean, price: number | null, seconds: number | null): string {
  return scanTagLines(height, range, held, price, seconds).join(' · ')
}

/** The line under the controls while a scan runs, or after it. */
export function scanLine(job: ScanJob | null, result: ScanResult | null, percent: number | null, elapsed: number, cloudStatus: CloudStatus, buyingStatus: 'submitting' | 'computing' | null, confirmSats: number | null = null): string | null {
  if (!job && confirmSats !== null) return `PRESS AGAIN TO PAY ${confirmSats} SATS`
  if (job) {
    if (job.asking) return 'ASKING RELAYS'
    if (job.route === 'cloud') {
      if (cloudStatus === 'awaiting_payment') return 'PAY THE INVOICE'
      if (buyingStatus === 'submitting' || cloudStatus === 'quoting') return 'ASKING HOSAKA'
      return `HOSAKA SCANNING 2^${job.height}`
    }
    return `SCANNING 2^${job.height} · ${percent !== null ? `${percent}%` : `${elapsed} S`}`
  }
  if (!result) return null
  if (result.kind === 'cancelled') return 'CANCELLED'
  if (result.kind === 'failed') return result.message
  // Said with its height: a scan at 2^H opens what was hidden at H, not below it.
  return result.count > 0 ? `FOUND ${result.count} AT 2^${result.height}` : `NOTHING AT 2^${result.height}`
}

/** A local scan's progress from the benchmark's estimate: never 100 until it is done. */
export function scanPercent(job: ScanJob | null, now: number): number | null {
  if (!job || job.route !== 'local' || job.asking || job.estSeconds === null || job.estSeconds <= 0) return null
  return Math.min(99, Math.floor(((now - job.startedAt) / 1000 / job.estSeconds) * 100))
}

/**
 * Only in SCAN: a thin gate, so the controls' subscriptions (the cursor, the
 * keys, the cloud) cost nothing in the other modes.
 */
export function ScanControls(): JSX.Element | null {
  const active = useScan((s) => s.active)
  const viewing = useCyberspace((s) => s.viewing())
  const building = useBuilder((s) => s.active)
  return active && viewing && !building ? <ScanDock /> : null
}

function ScanDock(): JSX.Element {
  const height = useScan((s) => s.height)
  const job = useScan((s) => s.job)
  const result = useScan((s) => s.result)
  const confirm = useScan((s) => s.confirm)
  const cloudOff = useCyberspace((s) => s.cloudPrefs.mode === 'off')
  const cloudCap = useCyberspace((s) => s.cloud.limits?.max_hop_height ?? null)
  const limitsKnown = useCyberspace((s) => s.cloud.limits !== null)
  const cloudStatus = useCyberspace((s) => s.cloud.status)
  const cloudJob = useCyberspace((s) => s.cloud.job)
  const price = useCyberspace((s) => scanPrice(height, s))
  // The benchmark landing moves the local max (localKeyCeiling reads it) and the time.
  const hopHeight = useCalibration((s) => s.hopHeight)
  const cantorMsByHeight = useCalibration((s) => s.cantorMsByHeight)
  const provider = useCyberspace((s) => s.cloud.provider)
  const experience = useExperience((s) => ratioOf(s.samples))
  const range = scanRange(localKeyCeiling(), !cloudOff, cloudCap)
  const cursor = useCyberspace((s) => s.cursor)
  const plane = useCyberspace((s) => s.anchorPlane)
  const keys = useSecrets((s) => s.keys)
  const held = heldCube(keys, cursor, plane, height) !== null
  const buying = useSecrets((s) => s.buying)
  const bind = useRepeatable()

  // HOSAKA's caps and prices, and only those (never a kept job resumed).
  useEffect(() => {
    if (!limitsKnown && !cloudOff) void useCyberspace.getState().fetchCloudLimits()
  }, [limitsKnown, cloudOff])

  // A height past the range now (HOSAKA switched off): back to the top of it.
  useEffect(() => {
    if (!job && height > range.top) useScan.getState().setHeight(range.top)
  }, [job, height, range.top])

  // A local scan's clock, while it computes.
  const [now, setNow] = useState(() => Date.now())
  const ticking = job !== null && job.route === 'local' && !job.asking
  useEffect(() => {
    if (!ticking) return
    const t = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(t)
  }, [ticking])

  const cloud = !held && height > range.localMax
  const route = held ? 'held' : cloud ? 'cloud' : 'local'
  const armed = !job && confirm !== null && cloud && confirm.height === height && confirm.sats === price
  const cancellable = scanCancellable(job, { status: cloudStatus, job: cloudJob })
  const percent = scanPercent(job, now)
  const elapsed = job ? Math.max(0, Math.floor((now - job.startedAt) / 1000)) : 0
  const seconds = scanSeconds(height, route, { cantorMsByHeight, hopHeight, provider, experience })
  const line = scanLine(job, result, percent, elapsed, cloudStatus, buying?.status ?? null, armed ? confirm.sats : null)
  const goDisabled = job ? !cancellable : cloud && (price === null || buying !== null)
  const word = job ? (cancellable ? 'CANCEL' : cloudStatus === 'quoting' || buying?.status === 'submitting' ? 'ASKING' : 'PAID') : armed ? 'CONFIRM' : 'SCAN'
  const s = useScan.getState

  return (
    <div className="flyorbs scanorbs" role="group" aria-label="Scan">
      <div className="scanorbs__row">
        <div className="scanorbs__stepper" role="group" aria-label="Scan height">
          <button className="scanorbs__step" {...bind(() => s().stepHeight(1))} disabled={job !== null || height >= range.top} title="Raise the scan height (.)" aria-label="Raise the scan height">
            <ChevronUp size={18} strokeWidth={2.25} aria-hidden />
          </button>
          <span className="scanorbs__value" title={scanTag(height, range, held, price, seconds)}>
            <b>SCAN HEIGHT {height}</b>
            {/* A line each, so the dock stays as narrow as SCAN HEIGHT and the orb never moves. */}
            {scanTagLines(height, range, held, price, seconds).map((words) => (
              <span key={words} className="scanorbs__tag">{words}</span>
            ))}
          </span>
          <button className="scanorbs__step" {...bind(() => s().stepHeight(-1))} disabled={job !== null || height <= SCAN_MIN_HEIGHT} title="Lower the scan height (,)" aria-label="Lower the scan height">
            <ChevronDown size={18} strokeWidth={2.25} aria-hidden />
          </button>
        </div>
        <div className="scanorbs__go">
          {/* A click, not a press: a touch that only starts on the orb never pays. */}
          <button
            className={`flyorb scanorb${job ? ' is-busy' : ''}${cloud && !job ? ' is-hosaka' : ''}${armed ? ' is-armed' : ''}`}
            disabled={goDisabled}
            title={job ? (cancellable ? 'Cancel the scan (X)' : 'HOSAKA is on it. The key lands in your keyring when it is done')
              : armed ? `Press again to pay ${confirm.sats} sats to HOSAKA for this cube`
              : cloud ? (price === null ? 'HOSAKA has not given a price for this height yet' : `Scan the purple cube. HOSAKA computes it for ${price} sats`)
              : 'Scan the purple cube for hidden things (Space)'}
            aria-label={job ? (cancellable ? 'Cancel the scan' : 'HOSAKA is scanning') : armed ? `Confirm: pay ${confirm.sats} sats` : cloud && price !== null ? `Scan for ${price} sats` : 'Scan'}
            {...noCallout}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              if (job) s().cancel()
              else if (!goDisabled) void s().start({ route, sats: cloud ? price : undefined })
            }}
          >
            <span className="scanorb__word">{word}</span>
            {cloud && !job && price !== null && <span className="scanorb__sats">{price} SATS</span>}
          </button>
          {!cloud && !job && <span className="flyorb__key" aria-hidden>SPACE</span>}
        </div>
      </div>
      {line && (
        <div className={`scanorbs__line${result?.kind === 'failed' && !job && !armed ? ' is-error' : ''}`} role="status">
          <span>{line}</span>
          {percent !== null && <span className="scanorbs__bar" aria-hidden><span style={{ width: `${percent}%` }} /></span>}
        </div>
      )}
    </div>
  )
}
