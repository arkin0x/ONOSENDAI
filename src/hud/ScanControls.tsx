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
 * orb like the fly buttons, in purple, that says SCAN. Under the height a tag
 * says who computes it: this device, free, up to its benchmark; HOSAKA, with
 * the price, above it; a cube already held is only asked about again. While
 * a scan runs the orb is CANCEL and a line under the controls says how far
 * along it is; then what it found.
 */

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import { useSecrets } from '../store/useSecrets'
import { scanPrice, useScan, type ScanJob, type ScanResult } from '../store/useScan'
import { useCalibration } from '../lib/calibration'
import { localKeyCeiling } from '../lib/deployPlan'
import { heldCube, scanRange, SCAN_MIN_HEIGHT, type ScanRange } from '../lib/scanCube'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import type { CloudStatus } from '../store/useCyberspace'

/** The tag under the height: who computes it, and for what. */
export function scanTag(height: number, range: ScanRange, held: boolean, price: number | null, cloudOff: boolean): string {
  if (held) return 'HELD · FREE'
  if (height <= range.localMax) {
    if (height === range.top && !range.cloud) return cloudOff ? 'DEVICE MAX · HOSAKA OFF' : 'DEVICE MAX'
    return 'ON DEVICE · FREE'
  }
  return price === null ? 'HOSAKA · NO PRICE YET' : `HOSAKA · ${price} SATS`
}

/** The line under the controls while a scan runs, or after it. */
export function scanLine(job: ScanJob | null, result: ScanResult | null, percent: number | null, elapsed: number, cloudStatus: CloudStatus, buyingStatus: 'submitting' | 'computing' | null): string | null {
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
  return result.count > 0 ? `FOUND ${result.count}` : 'NOTHING FOUND'
}

/** A local scan's progress from the benchmark's estimate: never 100 until it is done. */
export function scanPercent(job: ScanJob | null, now: number): number | null {
  if (!job || job.route !== 'local' || job.asking || job.estSeconds === null || job.estSeconds <= 0) return null
  return Math.min(99, Math.floor(((now - job.startedAt) / 1000 / job.estSeconds) * 100))
}

export function ScanControls(): JSX.Element | null {
  const active = useScan((s) => s.active)
  const viewing = useCyberspace((s) => s.viewing())
  const building = useBuilder((s) => s.active)
  const height = useScan((s) => s.height)
  const job = useScan((s) => s.job)
  const result = useScan((s) => s.result)
  const cloudOff = useCyberspace((s) => s.cloudPrefs.mode === 'off')
  const cloudCap = useCyberspace((s) => s.cloud.limits?.max_hop_height ?? null)
  const limitsKnown = useCyberspace((s) => s.cloud.limits !== null)
  const cloudStatus = useCyberspace((s) => s.cloud.status)
  const price = useCyberspace((s) => scanPrice(height, s))
  // The benchmark landing moves the local max (localKeyCeiling reads it).
  useCalibration((s) => s.hopHeight)
  const range = scanRange(localKeyCeiling(), !cloudOff, cloudCap)
  const cursor = useCyberspace((s) => s.cursor)
  const plane = useCyberspace((s) => s.anchorPlane)
  const keys = useSecrets((s) => s.keys)
  const held = heldCube(keys, cursor, plane, height) !== null
  const buying = useSecrets((s) => s.buying)
  const shown = active && viewing && !building
  const bind = useRepeatable()

  // HOSAKA's caps, asked once, as the HOSAKA card asks for them.
  useEffect(() => {
    if (shown && !limitsKnown && !cloudOff) void useCyberspace.getState().resumeCloudJob()
  }, [shown, limitsKnown, cloudOff])

  // A height past the range now (HOSAKA switched off): back to the top of it.
  useEffect(() => {
    if (shown && !job && height > range.top) useScan.getState().setHeight(range.top)
  }, [shown, job, height, range.top])

  // A local scan's clock, while it computes.
  const [now, setNow] = useState(() => Date.now())
  const ticking = job !== null && job.route === 'local' && !job.asking
  useEffect(() => {
    if (!ticking) return
    const t = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(t)
  }, [ticking])

  if (!shown) return null

  const cloud = !held && height > range.localMax
  const percent = scanPercent(job, now)
  const elapsed = job ? Math.max(0, Math.floor((now - job.startedAt) / 1000)) : 0
  const line = scanLine(job, result, percent, elapsed, cloudStatus, buying?.status ?? null)
  const busyElsewhere = !job && cloud && buying !== null
  const goDisabled = !job && cloud && (price === null || busyElsewhere)
  const s = useScan.getState

  return (
    <div className="flyorbs scanorbs" role="group" aria-label="Scan">
      <div className="scanorbs__row">
        <div className="scanorbs__stepper" role="group" aria-label="Scan height">
          <button className="scanorbs__step" {...bind(() => s().stepHeight(1))} disabled={job !== null || height >= range.top} title="Raise the scan height (.)" aria-label="Raise the scan height">
            <ChevronUp size={18} strokeWidth={2.25} aria-hidden />
          </button>
          <span className="scanorbs__value">
            <b>SCAN HEIGHT {height}</b>
            <span className={`scanorbs__tag${cloud ? ' is-hosaka' : ''}`}>{scanTag(height, range, held, price, cloudOff)}</span>
          </span>
          <button className="scanorbs__step" {...bind(() => s().stepHeight(-1))} disabled={job !== null || height <= SCAN_MIN_HEIGHT} title="Lower the scan height (,)" aria-label="Lower the scan height">
            <ChevronDown size={18} strokeWidth={2.25} aria-hidden />
          </button>
        </div>
        <div className="flyorb__row scanorbs__go">
          <button
            className={`flyorb scanorb${job ? ' is-busy' : ''}${cloud && !job ? ' is-hosaka' : ''}`}
            disabled={goDisabled}
            title={job ? 'Cancel the scan (X)'
              : cloud ? (price === null ? 'HOSAKA has not given a price for this height yet' : `Scan the purple cube. HOSAKA computes it for ${price} sats`)
              : 'Scan the purple cube for hidden things (Space)'}
            aria-label={job ? 'Cancel the scan' : cloud && price !== null ? `Scan for ${price} sats` : 'Scan'}
            {...noCallout}
            onPointerDown={(e) => {
              e.preventDefault(); e.stopPropagation()
              if (job) s().cancel()
              else if (!goDisabled) void s().start()
            }}
          >
            <span className="scanorb__word">{job ? 'CANCEL' : 'SCAN'}</span>
            {cloud && !job && price !== null && <span className="scanorb__sats">{price} SATS</span>}
          </button>
          {!cloud && !job && <span className="flyorb__key" aria-hidden>SPACE</span>}
        </div>
      </div>
      {line && (
        <div className={`scanorbs__line${result?.kind === 'failed' ? ' is-error' : ''}`} role="status">
          <span>{line}</span>
          {percent !== null && <span className="scanorbs__bar" aria-hidden><span style={{ width: `${percent}%` }} /></span>}
        </div>
      )}
    </div>
  )
}
