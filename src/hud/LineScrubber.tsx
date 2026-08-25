/**
 * LineScrubber.tsx - scrub the Bitcoin block line as a place.
 *
 * ChainExplorer's mechanics pointed at a different one-dimensional thing:
 * block heights 0..tip instead of chain actions. Scrubbing flies the camera
 * to the stop under the mark (a focus, so nothing about your chain changes)
 * and SET DESTINATION hands the height to the Hyperspace panel.
 *
 * Open state IS scrubHeight in the store, so the H key and the chip drive
 * one mechanism and cannot disagree. No per-height ticks: the line is
 * hundreds of thousands of blocks, only the fill and the mark are drawn.
 */

import { useEffect, useMemo, useRef } from 'react'
import { xyzToCoord } from 'cyberspace-core'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import { useCyberspace } from '../store/useCyberspace'
import { exitHyperspaceView, getStopByHeight, getStopIndex, markViewedStop, ownHyperspaceView, useHyperspace } from '../store/useHyperspace'
import { findStation } from '../lib/hyperspace/station'
import { formatLatLon, stopPlane, stopPosition } from './HyperspacePanel'

/** The coarse step: the line is ~900k blocks, single steps are the last few. */
const JUMP = 1000

export function LineScrubber(): JSX.Element {
  const sync = useHyperspace((s) => s.sync)
  const tipHeight = useHyperspace((s) => s.tipHeight)
  const scrubHeight = useHyperspace((s) => s.scrubHeight)
  const destination = useHyperspace((s) => s.destination)
  const indexVersion = useHyperspace((s) => s.indexVersion)
  const bind = useRepeatable()
  const position = useCyberspace((s) => s.position)
  const plane = useCyberspace((s) => s.plane)

  // Your station: the block boarding sets you down at, recomputed as blocks
  // sync in. findStation, not a plain nearest query: §4.2 breaks distance
  // ties to the lowest height, and at void distances the shells are coarse
  // enough that ties are the normal case, so a sort-order nearest can name
  // a different block than the one the ride actually departs from.
  const station = useMemo(() => {
    void indexVersion
    const index = getStopIndex()
    if (index.permCount === 0) return undefined
    const here = xyzToCoord(position.x, position.y, position.z, plane)
    return findStation(index, here, tipHeight ?? Number.MAX_SAFE_INTEGER)?.stop
  }, [position, plane, indexVersion, tipHeight])

  const viewStation = (): void => {
    if (!station) return
    ownHyperspaceView()
    markViewedStop(station.height)
    useCyberspace.getState().focusOn(
      stopPosition(station),
      stopPlane(station),
      `STATION · BLOCK ${station.height}`,
      34,
    )
  }

  const ready = sync.status === 'ready' && tipHeight !== null
  const open = scrubHeight !== null

  // The focus side effect lives here rather than in the keyboard hook, so the
  // chip, the rail, the buttons and the H key all pass through one place.
  // Only a non-null to null transition clears the focus: clearing on every
  // null would stomp a focus someone else set (a shard, the EARTH button).
  // indexVersion re-runs it so a stop that syncs in late still gets flown to.
  const prev = useRef<number | null>(null)
  // Opening the scrubber must not steal the view: the mark parks on the
  // chosen destination (or the tip) and the first fly happens only once the
  // user actually moves it. Armed flips on the first height change and stays
  // set, so the indexVersion re-run can still fly to a stop that synced in
  // late, without un-parking a freshly opened scrubber.
  const armed = useRef(false)
  useEffect(() => {
    const was = prev.current
    prev.current = scrubHeight
    if (scrubHeight === null) {
      armed.current = false
      // Closed by any path that skipped exitHyperspaceView: settle through it
      // so an owned focus clears and a foreign one (a spectate) survives.
      if (was !== null) exitHyperspaceView()
      return
    }
    if (was === null) return
    if (was !== scrubHeight) armed.current = true
    if (!armed.current) return
    const stop = getStopByHeight(scrubHeight)
    if (!stop) return
    ownHyperspaceView()
    markViewedStop(stop.height)
    useCyberspace.getState().focusOn(
      stopPosition(stop),
      stopPlane(stop),
      `BLOCK ${stop.height} · ${stop.kind === 'port' ? 'PORT' : 'LANDFALL'}`,
      // A landfall is a place on Earth: frame the globe with the landfall's
      // side toward the camera instead of standing on the surface grid.
      stop.kind === 'landfall' ? 52 : 34,
    )
  }, [scrubHeight, indexVersion])

  const toggle = (): void => {
    const hs = useHyperspace.getState()
    if (hs.scrubHeight === null) hs.setScrubHeight(hs.destination ?? hs.tipHeight ?? 0)
    else exitHyperspaceView()
  }

  const step = (d: number) => (): void => {
    const hs = useHyperspace.getState()
    if (hs.scrubHeight === null || hs.tipHeight === null) return
    hs.setScrubHeight(Math.max(0, Math.min(hs.tipHeight, hs.scrubHeight + d)))
  }

  // The rail: press or drag anywhere on it to land on the nearest height.
  const rail = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const scrubTo = (clientX: number): void => {
    const r = rail.current?.getBoundingClientRect()
    const tip = useHyperspace.getState().tipHeight
    if (!r || r.width === 0 || tip === null || tip <= 0) return
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    useHyperspace.getState().setScrubHeight(Math.round(t * tip))
  }

  const tip = tipHeight ?? 0
  const fraction = tip <= 0 ? 0 : (scrubHeight ?? tip) / tip
  const stop = scrubHeight !== null ? getStopByHeight(scrubHeight) : undefined
  const syncPercent = sync.total > 0 ? Math.round((sync.loaded / sync.total) * 100) : 0

  return (
    <div className="explorer linescrub">
      <button
        className="chip explorer__toggle"
        {...noCallout}
        disabled={!ready}
        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); if (ready) toggle() }}
        aria-label={open ? 'Hide line scrubber' : 'Show line scrubber'}
        aria-pressed={open}
      >
        {ready
          ? destination !== null
            ? `HYPERSPACE ${destination}`
            : 'HYPERSPACE READY'
          : sync.status === 'loading-cache'
            ? `HYPERSPACE LOADING ${syncPercent}%`
            : `HYPERSPACE SYNCING ${syncPercent}%`}
      </button>

      {open && ready && (
        <div className="explorer__body">
          <span className="linescrub__headline">FROM YOUR STATION</span>
          <div className="linescrub__fromrow">
            <span className="explorer__type">{station ? `BLOCK ${station.height}` : 'NO BLOCKS YET'}</span>
            {station && (
              <span className={`linescrub__kind linescrub__kind--${station.kind}`}>
                {station.kind === 'port' ? 'PORT' : 'LANDFALL'}
              </span>
            )}
            <button
              className="linescrub__view"
              disabled={!station}
              {...noCallout}
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); viewStation() }}
            >VIEW</button>
          </div>

          <hr className="linescrub__hr" />
          <span className="linescrub__headline linescrub__headline--to">TO BLOCK</span>
          <div className="explorer__row">
            <button className="explorer__btn" title={`Back ${JUMP} blocks (hold to repeat)`} aria-label={`Back ${JUMP} blocks`} disabled={scrubHeight === 0} {...bind(step(-JUMP))}>«</button>
            <button className="explorer__btn" title="Back one block (hold to repeat)" aria-label="Back one block" disabled={scrubHeight === 0} {...bind(step(-1))}>◀</button>

            <div
              className="explorer__rail"
              ref={rail}
              role="slider"
              aria-label="Line position"
              aria-valuemin={0}
              aria-valuemax={tip}
              aria-valuenow={scrubHeight ?? tip}
              {...noCallout}
              onPointerDown={(e) => {
                e.preventDefault(); e.stopPropagation()
                dragging.current = true
                ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                scrubTo(e.clientX)
              }}
              onPointerMove={(e) => { if (dragging.current) scrubTo(e.clientX) }}
              onPointerUp={() => { dragging.current = false }}
              onPointerCancel={() => { dragging.current = false }}
            >
              <span className="explorer__line" />
              <span className="explorer__walked" style={{ width: `${fraction * 100}%` }} />
              <span className="explorer__mark" style={{ left: `${fraction * 100}%` }} />
            </div>

            <button className="explorer__btn" title="Forward one block (hold to repeat)" aria-label="Forward one block" disabled={scrubHeight === tip} {...bind(step(1))}>▶</button>
            <button className="explorer__btn" title={`Forward ${JUMP} blocks (hold to repeat)`} aria-label={`Forward ${JUMP} blocks`} disabled={scrubHeight === tip} {...bind(step(JUMP))}>»</button>
          </div>

          <div className="explorer__meta linescrub__meta">
            <div className="linescrub__info">
              <span className="explorer__type">BLOCK {scrubHeight}</span>
              {stop ? (
                <>
                  <span className={`linescrub__kind linescrub__kind--${stop.kind}`}>
                    {stop.kind === 'port' ? 'PORT · IDEASPACE' : "LANDFALL · DATASPACE · EARTH'S SURFACE"}
                  </span>
                  {stop.kind === 'landfall' && <span className="explorer__when">{formatLatLon(stop)}</span>}
                </>
              ) : (
                <span className="explorer__when">NO BLOCK DATA</span>
              )}
            </div>
            <div className="linescrub__actions">
            <button
              className={destination !== null ? 'linescrub__set linescrub__set--attached' : 'linescrub__set'}
              disabled={!stop}
              {...noCallout}
              onPointerDown={(e) => {
                e.preventDefault(); e.stopPropagation()
                if (scrubHeight !== null) useHyperspace.getState().setDestination(scrubHeight)
              }}
            >{destination !== null && destination === scrubHeight ? 'DESTINATION SET' : 'SET DESTINATION'}</button>
            {destination !== null && (
              <button
                className="linescrub__clear"
                title="Clear destination"
                aria-label="Clear destination"
                {...noCallout}
                onPointerDown={(e) => {
                  e.preventDefault(); e.stopPropagation()
                  useHyperspace.getState().setDestination(null)
                }}
              >✕</button>
            )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
