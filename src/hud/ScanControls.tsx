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
 * orb like the fly buttons, in purple, that says SCAN, over a faint watermark
 * of concentric cubes. Under the height (arkinox, 2026-11-15: "Can you make
 * them say a time estimate in white text for how long that height will take
 * to scan?", then: never FREE or HELD): UNKNOWN and how long this device
 * takes, from its benchmark (store/useScan.ts scanSeconds); COMPLETE for a
 * cube already held, which SCAN only asks the relays about again; HOSAKA
 * above the device max, the price on the SCAN button. At the top of the
 * range, DEVICE MAX or HOSAKA MAX on a line of its own under those, kept
 * when empty, so it coming never moves a thing. The words are white with a
 * dark edge, readable over the brightest scene. The keys are inside their
 * buttons as the Controls pad prints them (arkinox, 2026-11-15: "the scan
 * keyboard hints - i wanted them like the keyboard hints in the Controls
 * pad"): the pad's own `.touchpad__keyhint` (TouchControls.tsx), tiny and
 * dim at the bottom centre, . in up, , in down (a size up, or a lone mark
 * is a speck), SPACE in the SCAN orb (the word the pad prints for WALK's
 * jump), and unseen while the key does nothing. While a scan runs the orb
 * is CANCEL and a line centred under the height says how far along it is;
 * then what it found. That line has its room kept in every state, as tall as
 * its longest (three lines), so it showing or going never moves a button
 * (arkinox, 2026-11-15: "I don't like the layout jump here. 'press again to
 * pay' text shifts the buttons up."). A HOSAKA height the Cloud compute mode
 * asks about (ASK, or AUTO over its cap) takes two taps, and always two
 * presses of Space: the first arms CONFIRM with the price, the second pays
 * (store/useScan.ts scanSpace); the line says only PRESS AGAIN TO PAY, the
 * price being on the button already. A HOSAKA scan paid for has no CANCEL:
 * it finishes, and the key is held as bought.
 */

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import { useSecrets } from '../store/useSecrets'
import { scanCancellable, scanPrice, scanSeconds, scanSpace, useScan, type ScanJob, type ScanResult } from '../store/useScan'
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
 * The words under the height, a line each (arkinox, 2026-11-15): never FREE
 * or HELD. A cube not held yet is UNKNOWN and how long this device takes to
 * scan it; a cube already held is COMPLETE (SCAN only asks the relays again);
 * a HOSAKA height says HOSAKA, and the SCAN button carries its price.
 */
export function scanTagLines(height: number, range: ScanRange, held: boolean, seconds: number | null): string[] {
  if (held) return ['COMPLETE']
  if (height > range.localMax) return ['HOSAKA']
  return ['UNKNOWN', seconds === null ? 'TIME UNKNOWN' : scanTime(seconds)]
}

/** The same words on one line: the tooltip, and what the tests read. */
export function scanTag(height: number, range: ScanRange, held: boolean, seconds: number | null): string {
  return scanTagLines(height, range, held, seconds).join(' · ')
}

/** What the SCAN button says under its word: a HOSAKA height's price, always, or that there is none yet. */
export function scanOrbSats(cloud: boolean, busy: boolean, price: number | null): string | null {
  if (!cloud || busy) return null
  return price === null ? 'NO PRICE' : `${price} SATS`
}

/**
 * The line under the controls while a scan runs, or after it. Armed, only
 * what to do: the price is on the CONFIRM button above it.
 */
export function scanLine(job: ScanJob | null, result: ScanResult | null, percent: number | null, elapsed: number, cloudStatus: CloudStatus, buyingStatus: 'submitting' | 'computing' | null, armed = false): string | null {
  if (!job && armed) return 'PRESS AGAIN TO PAY'
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
 * A button's keyboard key, the Controls pad's way (TouchControls.tsx
 * PadKey.keyHint): its class, so the two are one style. Kept in place,
 * unseen, while the key does nothing.
 */
function KeyHint({ keyName, off }: { keyName: string; off: boolean }): JSX.Element {
  // A lone . or , a size up (styles.css): at the pad's size it is a speck.
  const mark = keyName === '.' || keyName === ','
  return <span className={`touchpad__keyhint${mark ? ' is-mark' : ''}${off ? ' is-off' : ''}`} aria-hidden>{keyName}</span>
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
  const line = scanLine(job, result, percent, elapsed, cloudStatus, buying?.status ?? null, armed)
  const goDisabled = job ? !cancellable : cloud && (price === null || buying !== null)
  const word = job ? (cancellable ? 'CANCEL' : cloudStatus === 'quoting' || buying?.status === 'submitting' ? 'ASKING' : 'PAID') : armed ? 'CONFIRM' : 'SCAN'
  const orbSats = scanOrbSats(cloud, job !== null, price)
  const s = useScan.getState

  return (
    <div className="flyorbs scanorbs" role="group" aria-label="Scan">
      <div className="scanorbs__row">
        <div className="scanorbs__stepper" role="group" aria-label="Scan height">
          <button className="scanorbs__step" {...bind(() => s().stepHeight(1))} disabled={job !== null || height >= range.top} title={height < range.top ? 'Raise the scan height (.)' : range.cloud ? 'The highest height HOSAKA scans' : 'This device\'s max. Turn HOSAKA on to scan higher'} aria-label="Raise the scan height">
            <ChevronUp size={18} strokeWidth={2.25} aria-hidden />
            <KeyHint keyName="." off={job !== null || height >= range.top} />
          </button>
          <span className="scanorbs__value" title={scanTag(height, range, held, seconds)}>
            <b>SCAN HEIGHT {height}</b>
            {/* A line each, so the dock stays as narrow as SCAN HEIGHT and the orb never moves. */}
            {scanTagLines(height, range, held, seconds).map((words) => (
              <span key={words} className="scanorbs__tag">{words}</span>
            ))}
            {/* At the top, why up stops. Its line is kept when empty, so it coming never moves a thing. */}
            <span className="scanorbs__max">{height >= range.top && !job ? (range.cloud ? 'HOSAKA MAX' : 'DEVICE MAX') : ''}</span>
          </span>
          <button className="scanorbs__step" {...bind(() => s().stepHeight(-1))} disabled={job !== null || height <= SCAN_MIN_HEIGHT} title="Lower the scan height (,)" aria-label="Lower the scan height">
            <ChevronDown size={18} strokeWidth={2.25} aria-hidden />
            <KeyHint keyName="," off={job !== null || height <= SCAN_MIN_HEIGHT} />
          </button>
        </div>
        <div className="scanorbs__go">
          {/* A click, not a press: a touch that only starts on the orb never pays. */}
          <button
            className={`flyorb scanorb${job ? ' is-busy' : ''}${cloud && !job ? ' is-hosaka' : ''}${armed ? ' is-armed' : ''}`}
            disabled={goDisabled}
            title={job ? (cancellable ? 'Cancel the scan (X)' : 'HOSAKA is on it. The key lands in your keyring when it is done')
              : armed ? `Press again to pay ${confirm.sats} sats to HOSAKA for this cube (Space)`
              : cloud ? (price === null ? 'HOSAKA has not given a price for this height yet' : `Scan the purple cube. HOSAKA computes it for ${price} sats${seconds === null ? '' : `, in ${scanTime(seconds).toLowerCase()}`}. With Space, press twice to pay`)
              : 'Scan the purple cube for hidden things (Space)'}
            aria-label={job ? (cancellable ? 'Cancel the scan' : 'HOSAKA is scanning') : armed ? `Confirm: pay ${confirm.sats} sats` : cloud && price !== null ? `Scan for ${price} sats` : 'Scan'}
            {...noCallout}
            onPointerDown={(e) => e.stopPropagation()}
            // Space or Enter on the focused orb are Space in SCAN: never one press to pay,
            // never again while held (store/useScan.ts scanSpace), and no click after.
            onKeyDown={(e) => {
              if (e.key !== ' ' && e.key !== 'Enter') return
              e.preventDefault()
              e.stopPropagation()
              if (job) { if (!e.repeat) s().cancel() } else scanSpace(e.repeat)
            }}
            onKeyUp={(e) => { if (e.key === ' ') e.preventDefault() }}
            onClick={(e) => {
              e.stopPropagation()
              if (job) s().cancel()
              // A click with no pointer (a screen reader's) asks twice too, as Space does.
              else if (!goDisabled) void s().start({ route, sats: cloud ? price : undefined, confirmFirst: e.detail === 0 })
            }}
          >
            <span className="scanorb__word">{word}</span>
            {orbSats && <span className="scanorb__sats">{orbSats}</span>}
            {/* Space does nothing while a scan runs (X cancels) or where the orb is disabled. */}
            <KeyHint keyName="SPACE" off={job !== null || goDisabled} />
          </button>
        </div>
      </div>
      {/* Always here, at one height (the longest line's), empty or not: the row above never moves. */}
      <div className={`scanorbs__line${line && result?.kind === 'failed' && !job && !armed ? ' is-error' : ''}${line && percent !== null ? ' has-bar' : ''}`} role="status" title={line ?? undefined}>
        {line && <span>{line}</span>}
        {line && percent !== null && <span className="scanorbs__bar" aria-hidden><span style={{ width: `${percent}%` }} /></span>}
      </div>
    </div>
  )
}
