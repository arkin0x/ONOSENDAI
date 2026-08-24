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
import { estimateHopCost, estimateSidestepCost } from 'cyberspace-core'
import { useCalibration } from '../lib/calibration'
import { formatMs, formatOps } from '../lib/space'
import { samePosition, sidestepTarget, useCyberspace } from '../store/useCyberspace'

/** Rough single-thread JS hash rate, for the pre-commit wall-clock hint. */
const HASHES_PER_SECOND = 1_500_000

function StatusLabel({ status }: { status: string }): JSX.Element {
  const label: Record<string, string> = {
    idle: 'IDLE',
    uncommitted: 'UNCOMMITTED',
    'sidestep-ready': 'SIDESTEP READY',
    computing: 'COMPUTING',
    hashing: 'HASHING',
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
  // What calibration measured this machine finishing in budget: conservative
  // defaults until the quiet benchmark lands, then the line updates in place.
  const hopCeil = useCalibration((s) => s.hopHeight)
  const sidestepCeil = useCalibration((s) => s.sidestepHeight)

  // Live preview of the action the cursor is lining up. Both estimates are
  // closed-form, so cheap enough to run on every noodle.
  const preview = useMemo(() => {
    if (samePosition(position, cursor)) return null
    const hop = estimateHopCost(
      position.x, position.y, position.z,
      cursor.x, cursor.y, cursor.z,
      plane,
    )
    if (!hop.exceedsLimit) return { hop, sidestep: null }
    const landing = sidestepTarget(position, cursor)
    const sidestep = estimateSidestepCost(
      position.x, position.y, position.z,
      landing.x, landing.y, landing.z,
    )
    return { hop, sidestep }
  }, [position, cursor, plane])

  const previewing = preview !== null && proof.status !== 'computing'
  const status =
    proof.status === 'computing'
      ? proof.mode === 'sidestep' ? 'hashing' : 'computing'
      : previewing
        ? preview.sidestep ? 'sidestep-ready' : 'uncommitted'
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

      {previewing && preview.sidestep ? (
        <>
          <dl className="stats">
            <div>
              <dt>Wall height</dt>
              <dd>2^{preview.sidestep.maxHeight}</dd>
            </div>
            <div>
              <dt>Est. SHA-256 hashes</dt>
              <dd>{formatOps(preview.sidestep.totalHashes)}</dd>
            </div>
            <div>
              <dt>LCA x / y / z</dt>
              <dd>{`${preview.sidestep.lcaX} / ${preview.sidestep.lcaY} / ${preview.sidestep.lcaZ}`}</dd>
            </div>
            <div>
              <dt>Rough time</dt>
              <dd>~{formatMs((preview.sidestep.totalHashes / HASHES_PER_SECOND) * 1000)}</dd>
            </div>
          </dl>
          <p className="notice notice--sidestep">
            Beyond the 2^20 Cantor ceiling: the pairing tree would not fit in
            memory. Space commits a Merkle SIDESTEP instead, landing 1 gibson
            past the wall; the cursor keeps the rest of the journey for the
            next commit. X cancels mid-hash.
          </p>
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
