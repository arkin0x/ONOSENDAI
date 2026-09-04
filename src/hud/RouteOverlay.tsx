/**
 * RouteOverlay.tsx - the route the cursor lines up, live, above the controls.
 *
 * The Movement proof panel lists the steps of the way to the cursor; on a
 * phone that panel is behind the menu, and on any screen the cursor moves
 * while it is read. This is the same list (routePreview.ts), compact, pinned
 * above the pad, changing as the cursor does: what the COMMIT button will do
 * first, and everything after it. Informational only: taps pass through.
 */

import { useCyberspace } from '../store/useCyberspace'
import { previewWindow, routeLabel, useRoutePreview } from './routePreview'

const HEAD = 4
const TAIL = 2

export function RouteOverlay(): JSX.Element | null {
  const atHead = useCyberspace((s) => s.atHead())
  const plan = useCyberspace((s) => s.plan)
  const computing = useCyberspace((s) => s.proof.status === 'computing')
  const preview = useRoutePreview()
  if (!atHead || plan !== null || computing || preview === null) return null

  const { hop, route, steps, needsCloud } = preview
  const summary = route === null
    ? 'ONE HOP'
    : route.infeasibleAt !== null ? 'OUT OF REACH' : routeLabel(route).toUpperCase()
  const rows = route === null
    ? [{ index: 0, kind: 'HOP', height: `2^${hop.maxHeight}`, state: 'next', label: 'this machine' }]
    : steps ? previewWindow(steps, HEAD, TAIL) : []

  return (
    <div className={`routeov ${needsCloud ? 'routeov--cloud' : ''} ${route?.infeasibleAt !== null && route !== null ? 'routeov--blocked' : ''}`} role="status" aria-live="off">
      <div className="routeov__head">
        <span className="routeov__title">ROUTE</span>
        <span className="routeov__sum">{summary}{needsCloud ? ' · HOSAKA' : ''}</span>
      </div>
      {rows.length > 0 && (
        <ul className="route route--preview route--overlay">
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
