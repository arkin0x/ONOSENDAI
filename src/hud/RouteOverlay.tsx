/**
 * RouteOverlay.tsx - the route the cursor lines up, live, above the controls.
 *
 * The Movement proof panel lists the steps of the way to the cursor; on a
 * phone that panel is behind the menu, and on any screen the cursor moves
 * while it is read. This is the same list (routePreview.ts), compact, pinned
 * above the pad, changing as the cursor does: what the COMMIT button will do
 * first, and everything after it.
 *
 * It sits in the lower left, over the menu button, and fills the width up to
 * the controls without ever reaching them (styles.css, "Route overlay"). It
 * grows upward with the number of steps until it is 35% of the screen tall,
 * and past that the list scrolls with no visible bar. Taps pass through it to
 * the scene while everything fits; only once the list overflows does it take
 * the pointer, so a finger, a wheel or the arrow keys can scroll it.
 */

import { useLayoutEffect, useRef, useState } from 'react'
import { useCyberspace } from '../store/useCyberspace'
import { previewWindow, routeLabel, useRoutePreview } from './routePreview'

// Enough rows to reach the 35% cap on any screen, so the height follows the
// route and the rest scrolls; a walk longer than this still folds its middle
// into a gap row, which keeps a 2,000 step walk from rebuilding 2,000 rows on
// every cursor press.
const HEAD = 40
const TAIL = 10

export function RouteOverlay(): JSX.Element | null {
  const atHead = useCyberspace((s) => s.atHead())
  const plan = useCyberspace((s) => s.plan)
  const computing = useCyberspace((s) => s.proof.status === 'computing')
  const preview = useRoutePreview()
  const shown = atHead && plan === null && !computing && preview !== null
  // Whether the list is taller than the cap allows, measured after layout so
  // the class is right before paint. Re-measured whenever the route changes
  // (a new preview) and whenever the list box itself resizes (the viewport).
  const listRef = useRef<HTMLUListElement>(null)
  const [scrollable, setScrollable] = useState(false)
  useLayoutEffect(() => {
    const el = listRef.current
    if (!shown || !el) { setScrollable(false); return }
    const measure = () => setScrollable(el.scrollHeight > el.clientHeight + 1)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [shown, preview])
  if (!shown || preview === null) return null

  const { hop, route, steps, needsCloud } = preview
  const summary = route === null
    ? 'ONE HOP'
    : route.infeasibleAt !== null ? 'OUT OF REACH' : routeLabel(route).toUpperCase()
  const rows = route === null
    ? [{ index: 0, kind: 'HOP', height: `2^${hop.maxHeight}`, state: 'next', label: 'this machine' }]
    : steps ? previewWindow(steps, HEAD, TAIL) : []

  return (
    <div className={`routeov ${needsCloud ? 'routeov--cloud' : ''} ${route?.infeasibleAt !== null && route !== null ? 'routeov--blocked' : ''}${scrollable ? ' routeov--scroll' : ''}`} role="status" aria-live="off">
      <div className="routeov__head">
        <span className="routeov__title">ROUTE</span>
        <span className="routeov__sum">{summary}{needsCloud ? ' · HOSAKA' : ''}</span>
      </div>
      {rows.length > 0 && (
        <ul
          ref={listRef}
          className="route route--preview route--overlay"
          // Focusable only while there is something to scroll, so the arrow
          // keys and Page Up/Down reach it after a click or tap on it.
          tabIndex={scrollable ? 0 : undefined}
          aria-label={scrollable ? 'Route steps, scrollable' : undefined}
        >
          {rows.map((r, i) => typeof r === 'number' ? (
            <li key={`gap-${i}`} className="route__step route__step--gap">
              <span className="route__index">…</span>
              <span className="route__kind">{`${r} more`}</span>
            </li>
          ) : (
            <li key={r.index} className={`route__step route__step--${r.state}`}>
              <span className="route__index">{r.index + 1}</span>
              <span className="route__kind">{r.kind}</span>
              <span className="route__height">{r.height}</span>
              <span className="route__state">{r.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
