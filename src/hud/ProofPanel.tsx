/**
 * ProofPanel.tsx - live movement proof telemetry.
 *
 * The point of this panel is that movement in Cyberspace is not free and not
 * uniform. While the cursor is away from the avatar it previews what the
 * uncommitted hop would cost (the estimate is closed-form, so it is live);
 * once committed it streams the real computation; and when a hop is beyond
 * the Cantor compute ceiling it says so explicitly rather than failing
 * quietly.
 */

import { useMemo } from 'react'
import { estimateHopCost } from 'cyberspace-core'
import { formatMs, formatOps } from '../lib/space'
import { samePosition, useCyberspace } from '../store/useCyberspace'

function StatusLabel({ status }: { status: string }): JSX.Element {
  const label: Record<string, string> = {
    idle: 'IDLE',
    uncommitted: 'UNCOMMITTED',
    computing: 'COMPUTING',
    done: 'PROVEN',
    infeasible: 'SIDESTEP REQUIRED',
  }
  return <span className={`status status--${status}`}>{label[status] ?? status}</span>
}

export function ProofPanel(): JSX.Element {
  const proof = useCyberspace((s) => s.proof)
  const position = useCyberspace((s) => s.position)
  const cursor = useCyberspace((s) => s.cursor)
  const plane = useCyberspace((s) => s.plane)

  // Live preview of the hop the cursor is lining up. Closed-form, so cheap
  // enough to run on every noodle.
  const estimate = useMemo(() => {
    if (samePosition(position, cursor)) return null
    return estimateHopCost(
      position.x, position.y, position.z,
      cursor.x, cursor.y, cursor.z,
      plane,
    )
  }, [position, cursor, plane])

  const previewing = estimate !== null && proof.status !== 'computing'
  const status = previewing ? 'uncommitted' : proof.status

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

      {previewing ? (
        <>
          <dl className="stats">
            <div>
              <dt>Est. Cantor ops</dt>
              <dd>{formatOps(estimate.totalOps)}</dd>
            </div>
            <div>
              <dt>Max LCA h</dt>
              <dd>{estimate.maxHeight}</dd>
            </div>
            <div>
              <dt>LCA x / y / z</dt>
              <dd>{`${estimate.lcaX} / ${estimate.lcaY} / ${estimate.lcaZ}`}</dd>
            </div>
            <div>
              <dt>Terrain K</dt>
              <dd>{estimate.terrainK}</dd>
            </div>
          </dl>

          {estimate.exceedsLimit ? (
            <p className="notice">
              Beyond the compute ceiling: this hop would need ~2^
              {estimate.maxHeight} pairings. The protocol crosses boundaries
              this large with a Merkle sidestep. Walk the cursor back or scale
              down.
            </p>
          ) : (
            <p className="legend__note">Space commits this hop. X recalls the cursor.</p>
          )}
        </>
      ) : (
        <>
          <dl className="stats">
            <div>
              <dt>Elapsed</dt>
              <dd>{formatMs(proof.elapsedMs)}</dd>
            </div>
            <div>
              <dt>Cantor ops</dt>
              <dd>{proof.totalOps === null ? '—' : formatOps(proof.totalOps)}</dd>
            </div>
            <div>
              <dt>Terrain K</dt>
              <dd>{proof.terrainK === null ? '—' : proof.terrainK}</dd>
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
    </section>
  )
}
