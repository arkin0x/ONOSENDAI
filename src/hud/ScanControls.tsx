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
 * orb like the fly buttons, in purple, that says SCAN, with a faint
 * watermark of nested cubes. Under the height a tag says where the cube
 * stands (owner, 2026-11-15): UNKNOWN and this device's time for it, up to
 * its benchmark; COMPLETE for a cube whose key is held, which SCAN only asks
 * the relays about again; HOSAKA above the benchmark, where the orb itself
 * carries the price in sats. "." under the up button and "," under the down
 * one are their keys, as SPACE beside the orb is. While a scan runs the orb
 * is CANCEL and a line under the height, centred in its column as SCAN HEIGHT
 * is, says how far along it is; then what it found. A HOSAKA height the Cloud
 * compute mode asks about (ASK, or AUTO over its cap) takes two presses: the
 * first arms CONFIRM with the price, the second pays (store/useScan.ts).
 * Space always takes two there, whatever the mode. A HOSAKA scan paid for has
 * no CANCEL: it finishes, and the key is held as bought.
 */

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import { useSecrets } from '../store/useSecrets'
import { scanCancellable, scanPrice, useScan, type ScanJob, type ScanResult } from '../store/useScan'
import { useCalibration } from '../lib/calibration'
import { localKeyCeiling, localKeySeconds } from '../lib/deployPlan'
import { heldCube, scanRange, SCAN_MIN_HEIGHT, type ScanRange } from '../lib/scanCube'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import type { CloudStatus } from '../store/useCyberspace'

/** A scan's time as the tag says it: "ABOUT 40 SEC", "ABOUT 3 MIN", "ABOUT 2 HR". */
export function aboutTime(seconds: number): string {
  if (seconds < 1) return 'UNDER 1 SEC'
  if (seconds < 90) return `ABOUT ${Math.round(seconds)} SEC`
  if (seconds < 90 * 60) return `ABOUT ${Math.round(seconds / 60)} MIN`
  if (seconds < 48 * 3600) return `ABOUT ${Math.round(seconds / 3600)} HR`
  return `ABOUT ${Math.round(seconds / 86_400)} DAYS`
}

/**
 * The tag under the height (owner, 2026-11-15): COMPLETE when the cube's key
 * is held already (SCAN still asks the relays again); UNKNOWN and this
 * device's time for it when it is not; HOSAKA above the device's range, whose
 * price is on the SCAN button. Never FREE or HELD.
 */
export function scanTag(height: number, range: ScanRange, held: boolean, seconds: number | null): string {
  if (held) return 'COMPLETE'
  if (height > range.localMax) return 'HOSAKA'
  return seconds === null ? 'UNKNOWN' : `UNKNOWN · ${aboutTime(seconds)}`
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

/** The dock itself (exported for its tests). */
export function ScanDock(): JSX.Element {
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
  useCalibration((s) => s.hopHeight)
  const cantorMs = useCalibration((s) => s.cantorMsByHeight)
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
  const line = scanLine(job, result, percent, elapsed, cloudStatus, buying?.status ?? null, armed ? confirm.sats : null)
  const goDisabled = job ? !cancellable : cloud && (price === null || buying !== null)
  // Above the device's range the button carries HOSAKA's price itself (owner,
  // 2026-11-15), then CONFIRM over it; the price is never hidden.
  const priceWord = price === null ? 'NO PRICE' : `${price} SATS`
  const word = job ? (cancellable ? 'CANCEL' : cloudStatus === 'quoting' || buying?.status === 'submitting' ? 'ASKING' : 'PAID') : armed ? 'CONFIRM' : cloud ? priceWord : 'SCAN'
  const satsUnder = cloud && price !== null && word !== priceWord
  const s = useScan.getState

  return (
    <div className="flyorbs scanorbs" role="group" aria-label="Scan">
      <div className="scanorbs__row">
        <div className="scanorbs__stepper" role="group" aria-label="Scan height">
          <button className="scanorbs__step" {...bind(() => s().stepHeight(1))} disabled={job !== null || height >= range.top} title="Raise the scan height (.)" aria-label="Raise the scan height">
            <ChevronUp size={18} strokeWidth={2.25} aria-hidden />
          </button>
          <span className="flyorb__key scanorbs__key" aria-hidden>.</span>
          <span className="scanorbs__value">
            <b>SCAN HEIGHT {height}</b>
            <span className={`scanorbs__tag${cloud ? ' is-hosaka' : ''}`}>{scanTag(height, range, held, localKeySeconds(height, cantorMs))}</span>
          </span>
          <button className="scanorbs__step" {...bind(() => s().stepHeight(-1))} disabled={job !== null || height <= SCAN_MIN_HEIGHT} title="Lower the scan height (,)" aria-label="Lower the scan height">
            <ChevronDown size={18} strokeWidth={2.25} aria-hidden />
          </button>
          <span className="flyorb__key scanorbs__key" aria-hidden>,</span>
        </div>
        <div className="scanorbs__go">
          {/* A click, not a press: a touch that only starts on the orb never pays. */}
          <button
            className={`flyorb scanorb${job ? ' is-busy' : ''}${cloud && !job ? ' is-hosaka' : ''}${armed ? ' is-armed' : ''}`}
            disabled={goDisabled}
            title={job ? (cancellable ? 'Cancel the scan (X)' : 'HOSAKA is on it. The key lands in your keyring when it is done')
              : armed ? `Press again to pay ${confirm.sats} sats to HOSAKA for this cube`
              : cloud ? (price === null ? 'HOSAKA has not given a price for this height yet' : `Scan the purple cube. HOSAKA computes it for ${price} sats (Space twice)`)
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
            {satsUnder && <span className="scanorb__sats">{`${price} SATS`}</span>}
          </button>
          {/* Space is a tap here, in HOSAKA's range too: there the first press shows CONFIRM, the second pays (hooks/useKeyboard). */}
          {!job && <span className="flyorb__key scanorbs__key" aria-hidden>SPACE</span>}
        </div>
        {/* Under the height, in its column and on its centre line, as SCAN HEIGHT is (owner, 2026-11-15). */}
        {line && (
          <div className={`scanorbs__line${result?.kind === 'failed' && !job && !armed ? ' is-error' : ''}`} role="status">
            <span className="scanorbs__words">{line}</span>
            {percent !== null && <span className="scanorbs__bar" aria-hidden><span style={{ width: `${percent}%` }} /></span>}
          </div>
        )}
      </div>
    </div>
  )
}
