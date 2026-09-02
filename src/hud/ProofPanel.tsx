/**
 * ProofPanel.tsx - live movement proof telemetry.
 *
 * The point of this panel is that movement in Cyberspace is not free and not
 * uniform. While the cursor is away from the avatar it previews what the
 * uncommitted action would cost, live: a Cantor hop when the tree fits, a
 * Merkle sidestep across the wall when it does not. Once committed it streams
 * the real computation.
 */

import { useMemo } from 'react'
import { estimateHopCost } from 'cyberspace-core'
import { useCalibration } from '../lib/calibration'
import { planSummary, type PlanSummary } from '../lib/movePlan'
import { formatMs, formatOps } from '../lib/space'
import { MAX_COMPUTE_HEIGHT, samePosition, useCyberspace, type MovePlan } from '../store/useCyberspace'

function StatusLabel({ status }: { status: string }): JSX.Element {
  const label: Record<string, string> = {
    idle: 'IDLE',
    uncommitted: 'UNCOMMITTED',
    'route-ready': 'ROUTE READY',
    computing: 'COMPUTING',
    hashing: 'HASHING',
    signing: 'SIGN TO CONTINUE',
    paused: 'ROUTE PAUSED',
    failed: 'ROUTE FAILED',
    done: 'PROVEN',
    infeasible: 'INFEASIBLE',
  }
  return <span className={`status status--${status}`}>{label[status] ?? status}</span>
}

export function ProofPanel(): JSX.Element {
  const proof = useCyberspace((s) => s.proof)
  const position = useCyberspace((s) => s.position)
  const cursor = useCyberspace((s) => s.cursor)
  const plane = useCyberspace((s) => s.plane)
  // What calibration measured this machine finishing in budget: conservative
  // defaults until the quiet benchmark lands, then the line updates in place.
  const hopCeil = useCalibration((s) => s.hopHeight)
  const sidestepCeil = useCalibration((s) => s.sidestepHeight)

  const plan = useCyberspace((s) => s.plan)
  const resumePlan = useCyberspace((s) => s.resumePlan)
  const cancelPlan = useCyberspace((s) => s.cancelPlan)
  // The ceiling a commit would use right now: the hard cap lowered to what
  // calibration measured, the same number the store routes with.
  const ceiling = Math.min(MAX_COMPUTE_HEIGHT, hopCeil)

  // Live preview of the action the cursor is lining up. The hop estimate is
  // closed-form; the route summary walks the route's steps without keeping
  // them, cheap for anything a person would line up.
  const preview = useMemo(() => {
    if (samePosition(position, cursor)) return null
    const hop = estimateHopCost(
      position.x, position.y, position.z,
      cursor.x, cursor.y, cursor.z,
      plane,
      ceiling,
    )
    if (!hop.exceedsLimit) return { hop, route: null as PlanSummary | null }
    return { hop, route: planSummary(position, cursor, ceiling, 20_000) }
  }, [position, cursor, plane, ceiling])

  const previewing = preview !== null && proof.status !== 'computing' && plan === null
  const status =
    plan
      ? plan.status === 'paused' ? (plan.awaiting ? 'signing' : 'paused')
        : plan.status === 'failed' ? 'failed'
        : plan.step.kind === 'sidestep' ? 'hashing' : 'computing'
      : proof.status === 'computing'
        ? proof.mode === 'sidestep' ? 'hashing' : 'computing'
        : previewing
          ? preview.route ? 'route-ready' : 'uncommitted'
          : proof.status

  return (
    <section className="panel panel--proof">
      <header className="panel__head">
        <h2>Movement proof</h2>
        <StatusLabel status={status} />
      </header>

      <div className="bar">
        <div
          className={`bar__fill bar__fill--${proof.status}`}
          style={{ width: `${Math.round(proof.progress * 100)}%` }}
        />
      </div>

      {plan ? (
        <RouteView plan={plan} proof={proof} onResume={resumePlan} onCancel={cancelPlan} />
      ) : previewing && preview.route ? (
        <>
          <dl className="stats">
            <div>
              <dt>Route</dt>
              <dd>{routeLabel(preview.route)}</dd>
            </div>
            <div>
              <dt>Tallest wall</dt>
              <dd>2^{preview.route.tallestWall}</dd>
            </div>
            <div>
              <dt>LCA x / y / z</dt>
              <dd>{`${preview.hop.lcaX} / ${preview.hop.lcaY} / ${preview.hop.lcaZ}`}</dd>
            </div>
            <div>
              <dt>Hop ceiling</dt>
              <dd>h{ceiling}</dd>
            </div>
          </dl>
          <p className="notice notice--sidestep">
            {`A wall of 2^${preview.route.tallestWall} stands between you and the cursor, taller than this machine hops (h${ceiling}). `}
            A sidestep buys exactly 1 gibson through a wall, so the route is hops
            to the leaf touching the wall, the sidestep, then hops on, for every
            wall on the way. Space runs the route one step at a time and asks for a
            signature as each step lands. X stops it.
          </p>
          {preview.route.steps > 64 && (
            <p className="notice">
              {`That is a long walk: ${preview.route.capped ? 'more than ' : ''}${preview.route.sidesteps} sidesteps, each a signed event. A cloud hop from HOSAKA reaches the wall in one move once it is deployed.`}
            </p>
          )}
        </>
      ) : previewing ? (
        <>
          <dl className="stats">
            <div>
              <dt>Est. Cantor ops</dt>
              <dd>{formatOps(preview.hop.totalOps)}</dd>
            </div>
            <div>
              <dt>Max LCA h</dt>
              <dd>{preview.hop.maxHeight}</dd>
            </div>
            <div>
              <dt>LCA x / y / z</dt>
              <dd>{`${preview.hop.lcaX} / ${preview.hop.lcaY} / ${preview.hop.lcaZ}`}</dd>
            </div>
            <div>
              <dt>Terrain K</dt>
              <dd>{preview.hop.terrainK}</dd>
            </div>
          </dl>
          <p className="legend__note">Space commits this hop. X recalls the cursor.</p>
        </>
      ) : (
        <>
          <dl className="stats">
            <div>
              <dt>Type</dt>
              <dd>{proof.status === 'idle' ? '—' : proof.mode}</dd>
            </div>
            <div>
              <dt>Elapsed</dt>
              <dd>{formatMs(proof.elapsedMs)}</dd>
            </div>
            <div>
              <dt>{proof.mode === 'sidestep' ? 'SHA-256 hashes' : 'Cantor ops'}</dt>
              <dd>{proof.totalOps === null ? '—' : formatOps(proof.totalOps)}</dd>
            </div>
            <div>
              <dt>LCA x / y / z</dt>
              <dd>
                {proof.lca === null ? '—' : `${proof.lca.x} / ${proof.lca.y} / ${proof.lca.z}`}
              </dd>
            </div>
          </dl>

          {proof.proofHash && (
            <div className="hash">
              <span className="hash__label">proof</span>
              <code>{proof.proofHash}</code>
            </div>
          )}

          {proof.message && <p className="notice">{proof.message}</p>}
        </>
      )}

      <p className="legend__note">{`THIS MACHINE: HOP <= h${hopCeil} · SIDESTEP <= h${sidestepCeil}`}</p>
    </section>
  )
}

function routeLabel(r: PlanSummary): string {
  const more = r.capped ? '+' : ''
  const hops = `${r.hops}${more} hop${r.hops === 1 ? '' : 's'}`
  const sides = `${r.sidesteps}${more} sidestep${r.sidesteps === 1 ? '' : 's'}`
  return `${hops}, ${sides}`
}

/** The running route: where it is, what it is doing, and the two buttons. */
function RouteView({ plan, proof, onResume, onCancel }: {
  plan: MovePlan
  proof: { progress: number; elapsedMs: number }
  onResume: () => void
  onCancel: () => void
}): JSX.Element {
  const total = plan.summary.steps
  const n = plan.done + 1
  const step = plan.step
  const kind = step.kind === 'sidestep' ? 'SIDESTEP' : 'HOP'
  const what =
    step.kind === 'sidestep'
      ? `1 gibson through the wall at 2^${step.maxHeight}`
      : `up to the ${step.maxHeight === 0 ? 'same block' : `2^${step.maxHeight} block edge`}`
  const doing =
    plan.status === 'paused'
      ? plan.awaiting ? 'proof done, waiting for your signature' : 'paused'
      : plan.status === 'failed'
        ? 'failed'
        : `${step.kind === 'sidestep' ? 'hashing' : 'computing'} ${Math.round(proof.progress * 100)}%`
  return (
    <>
      <dl className="stats">
        <div>
          <dt>Route</dt>
          <dd>{`step ${n} of ${plan.summary.capped ? `${total}+` : total}`}</dd>
        </div>
        <div>
          <dt>This step</dt>
          <dd>{`${kind} ${what}`}</dd>
        </div>
        <div>
          <dt>Signed so far</dt>
          <dd>{`${plan.done} of ${total} (${plan.summary.hops} hops, ${plan.summary.sidesteps} sidesteps)`}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{doing}</dd>
        </div>
      </dl>
      <ol className="route">
        {routeWindow(plan).map((r) => (
          <li key={r.index} className={`route__step route__step--${r.state}`}>
            <span className="route__index">{r.index + 1}</span>
            <span className="route__kind">{r.kind}</span>
            <span className="route__height">{r.height}</span>
            <span className="route__state">{r.label}</span>
          </li>
        ))}
      </ol>
      {plan.message && <p className="notice">{plan.message}</p>}
      <div className="route__row">
        {plan.status === 'paused' && (
          <button className="route__button route__button--resume" onClick={onResume}>
            {plan.awaiting ? 'SIGN AND CONTINUE' : 'RESUME'}
          </button>
        )}
        <button className="route__button" onClick={onCancel}>
          {plan.status === 'running' ? 'STOP ROUTE' : 'CANCEL ROUTE'}
        </button>
      </div>
      <p className="legend__note">
        Steps already signed stay on the chain. Cancelling leaves you where the last one landed.
      </p>
    </>
  )
}

/** The few steps around the current one, as the panel lists them. */
function routeWindow(plan: MovePlan): Array<{ index: number; kind: string; height: string; state: string; label: string }> {
  const rows: Array<{ index: number; kind: string; height: string; state: string; label: string }> = []
  const first = Math.max(0, plan.done - 2)
  for (let i = first; i < plan.done; i++) rows.push({ index: i, kind: '·', height: '', state: 'done', label: 'signed' })
  const s = plan.step
  rows.push({
    index: plan.done,
    kind: s.kind === 'sidestep' ? 'SIDESTEP' : 'HOP',
    height: `h${s.maxHeight}`,
    state: plan.status,
    label: plan.status === 'running' ? 'now' : plan.status === 'paused' ? 'paused' : 'failed',
  })
  const remaining = plan.summary.steps - plan.done - 1
  if (remaining > 0) rows.push({ index: plan.done + 1, kind: '·', height: '', state: 'next', label: `${plan.summary.capped ? `${remaining}+` : remaining} more` })
  return rows
}
