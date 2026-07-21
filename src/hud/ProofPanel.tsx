/**
 * ProofPanel.tsx — live movement proof telemetry.
 *
 * The point of this panel is that movement in Cyberspace is not free and not
 * uniform. It shows what the last hop actually cost, and when a hop is beyond
 * the Cantor compute ceiling it says so explicitly rather than failing quietly.
 */

import { formatMs, formatOps } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'

function StatusLabel({ status }: { status: string }): JSX.Element {
  const label: Record<string, string> = {
    idle: 'IDLE',
    computing: 'COMPUTING',
    done: 'PROVEN',
    infeasible: 'SIDESTEP REQUIRED',
  }
  return <span className={`status status--${status}`}>{label[status] ?? status}</span>
}

export function ProofPanel(): JSX.Element {
  const proof = useCyberspace((s) => s.proof)

  return (
    <section className="panel panel--proof">
      <header className="panel__head">
        <h2>Movement proof</h2>
        <StatusLabel status={proof.status} />
      </header>

      <div className="bar">
        <div
          className={`bar__fill bar__fill--${proof.status}`}
          style={{ width: `${Math.round(proof.progress * 100)}%` }}
        />
      </div>

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
    </section>
  )
}
