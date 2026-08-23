/**
 * ChainExplorer.tsx — walk the chain, yours or anyone's.
 *
 * Every avatar is a line of signed actions, and the scene can stand at any
 * point on that line: this is the instrument that moves you along it. Step
 * back and forward, jump to the spawn or the head, or scrub the rail, and the
 * whole scene re-anchors on that action: the avatar, the trail up to it, the
 * terrain around it, the rooms, the XOR readout showing what that hop cost.
 *
 * It rides on the scene under the XOR readout rather than in a panel, for the
 * same reason the readout does: it is something you work while looking at the
 * space, not a fact you look up. Its heading is the chip that folds it away.
 *
 * Off the head the controls are withdrawn, because nothing in history is a
 * place you can move from; LIVE brings them back. Held buttons rapid-fire, and
 * [ ] Home End do the same from the keyboard.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import { formatAgo, formatStamp, shortHex } from '../lib/time'
import { useCyberspace } from '../store/useCyberspace'

/** Past this many actions the rail stops drawing a tick per action. */
const MAX_TICKS = 96

export function ChainExplorer(): JSX.Element {
  const events = useCyberspace((s) => s.events)
  const spectate = useCyberspace((s) => s.spectate)
  const exploreIndex = useCyberspace((s) => s.exploreIndex)
  // Parsed once per chain change; the store caches, this just subscribes.
  const actions = useMemo(() => useCyberspace.getState().focusChain(), [events, spectate])
  const last = actions.length - 1
  const index = exploreIndex ?? last
  const action = actions[index]
  const atHead = exploreIndex === null

  const [open, setOpen] = useState(true)
  // Relative times drift; refresh them on a slow clock rather than per frame.
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() / 1000), 10_000)
    return () => window.clearInterval(t)
  }, [])

  const bind = useRepeatable()
  const go = (i: number | null): void => useCyberspace.getState().explore(i)
  const step = (d: number) => () => useCyberspace.getState().exploreStep(d)

  // The rail: press or drag anywhere on it to land on the nearest action.
  const rail = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const scrubTo = (clientX: number): void => {
    const r = rail.current?.getBoundingClientRect()
    if (!r || r.width === 0 || last <= 0) return
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    go(Math.round(t * last))
  }

  const fraction = last <= 0 ? 1 : index / last
  const ticks = last + 1 <= MAX_TICKS ? actions.map((_, i) => (last === 0 ? 1 : i / last)) : []

  // A spectated pubkey with nothing on the relay has no chain to walk.
  if (actions.length === 0) return <></>

  return (
    <div className="explorer">
      <button
        className="chip explorer__toggle"
        {...noCallout}
        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v) }}
        aria-label={open ? 'Hide chain explorer' : 'Show chain explorer'}
        aria-pressed={open}
      >
        CHAIN {index + 1}/{actions.length}{atHead ? '' : ' HISTORY'}
      </button>

      {open && action && (
        <div className={`explorer__body ${atHead ? '' : 'is-history'}`}>
          <div className="explorer__row">
            <button className="explorer__btn" title="Spawn (Home)" aria-label="Go to spawn" disabled={index === 0} {...noCallout}
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); go(0) }}>|◀</button>
            <button className="explorer__btn" title="Back (hold to repeat, [ key)" aria-label="Back one action" disabled={index === 0} {...bind(step(-1))}>◀</button>

            <div
              className="explorer__rail"
              ref={rail}
              role="slider"
              aria-label="Chain position"
              aria-valuemin={1}
              aria-valuemax={actions.length}
              aria-valuenow={index + 1}
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
              {ticks.map((t, i) => (
                <span key={i} className={`explorer__tick ${i === 0 ? 'explorer__tick--spawn' : ''}`} style={{ left: `${t * 100}%` }} />
              ))}
              <span className="explorer__mark" style={{ left: `${fraction * 100}%` }} />
            </div>

            <button className="explorer__btn" title="Forward (hold to repeat, ] key)" aria-label="Forward one action" disabled={index >= last} {...bind(step(1))}>▶</button>
            <button className="explorer__btn" title="Head (End)" aria-label="Go to head" disabled={index >= last} {...noCallout}
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); go(null) }}>▶|</button>
          </div>

          <div className="explorer__meta">
            <span className={`explorer__type explorer__type--${action.type}`}>{action.type.toUpperCase()}</span>
            <span className="explorer__when" title={formatStamp(action.createdAt)}>{formatAgo(action.createdAt, now)}</span>
            {atHead ? (
              <span className="explorer__live">{spectate ? 'THEIR HEAD' : 'LIVE'}</span>
            ) : (
              <button className="explorer__return" {...noCallout}
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); go(null) }}>{spectate ? 'TO THEIR HEAD' : 'RETURN TO LIVE'}</button>
            )}
          </div>

          <div className="explorer__detail" title={action.coordHex}>
            <span className="explorer__key">C </span>{shortHex(action.coordHex, 10, 8)}
            <span className="explorer__key">  S </span>{action.sector}
          </div>
          {action.proofHash && (
            <div className="explorer__detail" title={action.proofHash}>
              <span className="explorer__key">proof </span>{shortHex(action.proofHash, 10, 8)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
