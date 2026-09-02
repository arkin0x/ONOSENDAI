/**
 * ProofPanel.tsx - live movement proof telemetry.
 *
 * The point of this panel is that movement in Cyberspace is not free and not
 * uniform. While the cursor is away from the avatar it previews what the
 * uncommitted action would cost, live: a Cantor hop when the tree fits this
 * machine, a HOSAKA cloud hop or sidestep when it does not and the cloud is
 * on, a Merkle sidestep across the wall otherwise. Once committed it streams
 * the real computation, or the cloud job's stations: quote, payment,
 * computing, verification.
 */

import { useMemo } from 'react'
import { estimateHopCost, estimateSidestepCost } from 'cyberspace-core'
import { useCalibration } from '../lib/calibration'
import { formatClock, routeCommit, satsOf, type CloudRoute } from '../lib/cloud'
import { formatMs, formatOps } from '../lib/space'
import { useNow } from '../hooks/useNow'
import { MAX_COMPUTE_HEIGHT, samePosition, sidestepTarget, useCyberspace } from '../store/useCyberspace'

/** Rough single-thread JS hash rate, for the pre-commit wall-clock hint. */
const HASHES_PER_SECOND = 1_500_000

const LABEL: Record<string, string> = {
  idle: 'IDLE',
  uncommitted: 'UNCOMMITTED',
  'sidestep-ready': 'SIDESTEP READY',
  'cloud-hop-ready': 'CLOUD HOP READY',
  'cloud-sidestep-ready': 'CLOUD SIDESTEP READY',
  computing: 'COMPUTING',
  hashing: 'HASHING',
  done: 'PROVEN',
  infeasible: 'SIDESTEP REQUIRED',
  quoting: 'CLOUD · QUOTING',
  confirm: 'CLOUD · CONFIRM',
  awaiting_payment: 'CLOUD · AWAITING PAYMENT',
  paid: 'CLOUD · PAID',
  'cloud-computing': 'CLOUD · COMPUTING',
  verifying: 'CLOUD · VERIFYING',
  'cloud-error': 'CLOUD FAILED',
}

/** The colour a status label wears; cloud states share one, the error is the danger red. */
function toneOf(status: string): string {
  if (status === 'cloud-error') return 'infeasible'
  if (status.startsWith('cloud-') || status === 'quoting' || status === 'confirm' || status === 'awaiting_payment' || status === 'paid' || status === 'verifying') return 'cloud'
  return status
}

function StatusLabel({ status }: { status: string }): JSX.Element {
  return <span className={`status status--${toneOf(status)}`}>{LABEL[status] ?? status}</span>
}

const STAGE: Record<string, string> = {
  quoting: 'quoting',
  confirm: 'awaiting your PAY',
  awaiting_payment: 'awaiting payment',
  paid: 'paid, starting',
  computing: 'computing',
  verifying: 'verifying here',
}

export function ProofPanel(): JSX.Element {
  const proof = useCyberspace((s) => s.proof)
  const position = useCyberspace((s) => s.position)
  const cursor = useCyberspace((s) => s.cursor)
  const plane = useCyberspace((s) => s.plane)
  const cloud = useCyberspace((s) => s.cloud)
  const cloudMode = useCyberspace((s) => s.cloudPrefs.mode)
  // What calibration measured this machine finishing in budget: conservative
  // defaults until the quiet benchmark lands, then the line updates in place.
  const hopCeil = useCalibration((s) => s.hopHeight)
  const sidestepCeil = useCalibration((s) => s.sidestepHeight)
  // The same ceiling commit() routes by.
  const ceiling = Math.min(MAX_COMPUTE_HEIGHT, hopCeil)

  const cloudActive = cloud.status !== 'idle' && cloud.status !== 'error'
  // The elapsed line only counts while a cloud job is in flight.
  const now = useNow(cloudActive ? 1000 : 0)

  // Live preview of the action the cursor is lining up. Both estimates are
  // closed-form, so cheap enough to run on every noodle. The route is the
  // one commit() would take right now, caps included.
  const preview = useMemo(() => {
    if (samePosition(position, cursor)) return null
    const hop = estimateHopCost(
      position.x, position.y, position.z,
      cursor.x, cursor.y, cursor.z,
      plane,
      ceiling,
    )
    if (!hop.exceedsLimit) return { hop, sidestep: null, route: 'local-hop' as CloudRoute }
    const landing = sidestepTarget(position, cursor, ceiling)
    const sidestep = estimateSidestepCost(
      position.x, position.y, position.z,
      landing.x, landing.y, landing.z,
    )
    const route = routeCommit({ maxHeight: hop.maxHeight, ceiling, mode: cloudMode, limits: cloud.limits })
    return { hop, sidestep, route }
  }, [position, cursor, plane, ceiling, cloudMode, cloud.limits])

  const previewing = preview !== null && proof.status !== 'computing' && !cloudActive
  const status = cloudActive
    ? cloud.status === 'computing' ? 'cloud-computing' : cloud.status
    : proof.status === 'computing'
      ? proof.mode === 'sidestep' ? 'hashing' : 'computing'
      : previewing
        ? preview.route === 'cloud-hop'
          ? 'cloud-hop-ready'
          : preview.route === 'cloud-sidestep'
            ? 'cloud-sidestep-ready'
            : preview.sidestep ? 'sidestep-ready' : 'uncommitted'
        : cloud.status === 'error' ? 'cloud-error' : proof.status

  // The bar: the worker's fraction locally; HOSAKA's estimate when it has one,
  // a sweep while it does not, full while this client verifies.
  const barFraction = cloudActive
    ? cloud.status === 'verifying' ? 1 : cloud.progress ?? 0
    : proof.progress
  const barClass = cloudActive
    ? `bar__fill bar__fill--cloud ${cloud.progress === null && cloud.status !== 'verifying' ? 'is-indeterminate' : ''}`
    : `bar__fill bar__fill--${proof.status}`

  const costMsats = cloud.job?.costMsats ?? cloud.quote?.costMsats ?? null

  return (
    <section className="panel panel--proof">
      <header className="panel__head">
        <h2>Movement proof</h2>
        <StatusLabel status={status} />
      </header>

      <div className="bar">
        <div className={barClass} style={{ width: `${Math.round(barFraction * 100)}%` }} />
      </div>

      {cloudActive ? (
        <>
          <dl className="stats">
            <div>
              <dt>Type</dt>
              <dd>{proof.mode} (cloud)</dd>
            </div>
            <div>
              <dt>Stage</dt>
              <dd>{STAGE[cloud.status] ?? cloud.status}</dd>
            </div>
            <div>
              <dt>Cost</dt>
              <dd>{costMsats === null ? '—' : `${satsOf(costMsats)} sats`}</dd>
            </div>
            <div>
              <dt>Elapsed</dt>
              <dd>{formatClock(now - (cloud.startedAt ?? now))}</dd>
            </div>
          </dl>
          {cloud.job && (
            <div className="hash">
              <span className="hash__label">HOSAKA job</span>
              <code>{cloud.job.jobId}</code>
            </div>
          )}
          {cloud.message && <p className="legend__note">{cloud.message}</p>}
          <p className="legend__note">
            {cloud.status === 'awaiting_payment'
              ? 'Pay the invoice from any Lightning wallet; the job starts when it settles. X abandons it.'
              : cloud.status === 'confirm'
                ? 'PAY submits the move to HOSAKA. CANCEL leaves the cursor lined up.'
                : 'X stops watching. A paid job is kept for RESUME while your chain head holds.'}
          </p>
        </>
      ) : previewing && preview.route === 'cloud-hop' ? (
        <>
          <dl className="stats">
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
            <div>
              <dt>Cloud hop cap</dt>
              <dd>h{cloud.limits?.max_hop_height ?? '?'}</dd>
            </div>
          </dl>
          <p className="notice notice--cloud">
            Beyond this machine (h{ceiling}), within HOSAKA&apos;s. Space asks for a
            quote and commits a CLOUD HOP straight to the cursor: you pay the
            invoice, HOSAKA computes, this client verifies before signing.
            {cloudMode === 'auto' ? ' AUTO skips the PAY step up to your budget.' : ''} X cancels.
          </p>
        </>
      ) : previewing && preview.sidestep ? (
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
              <dt>{preview.route === 'cloud-sidestep' ? 'Cloud sidestep cap' : 'Rough time'}</dt>
              <dd>
                {preview.route === 'cloud-sidestep'
                  ? `h${cloud.limits?.max_sidestep_height ?? '?'}`
                  : `~${formatMs((preview.sidestep.totalHashes / HASHES_PER_SECOND) * 1000)}`}
              </dd>
            </div>
          </dl>
          {preview.route === 'cloud-sidestep' ? (
            <p className="notice notice--cloud">
              Beyond this machine and beyond HOSAKA&apos;s hop cap. Space commits a
              CLOUD SIDESTEP: HOSAKA hashes the Merkle tree, this client checks
              the inclusion path, and you land 1 gibson past the wall; the
              cursor keeps the rest of the journey for the next commit. X cancels.
            </p>
          ) : (
            <p className="notice notice--sidestep">
              Beyond this machine&apos;s Cantor ceiling (h{ceiling}): the pairing tree
              would not fit in memory. Space commits a Merkle SIDESTEP instead,
              landing 1 gibson past the wall; the cursor keeps the rest of the
              journey for the next commit. X cancels mid-hash.
              {cloudMode === 'off' ? ' Cloud compute is OFF.' : cloud.limits === null ? ' HOSAKA has not answered, so the cloud is not on offer.' : ''}
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
              <dd>{proof.status === 'idle' ? '—' : `${proof.mode}${proof.source === 'cloud' ? ' (cloud)' : ''}`}</dd>
            </div>
            <div>
              <dt>Elapsed</dt>
              <dd>{formatMs(proof.elapsedMs)}</dd>
            </div>
            <div>
              <dt>{proof.source === 'cloud' ? 'Cost' : proof.mode === 'sidestep' ? 'SHA-256 hashes' : 'Cantor ops'}</dt>
              <dd>
                {proof.source === 'cloud'
                  ? proof.costMsats === null ? '—' : `${satsOf(proof.costMsats)} sats`
                  : proof.totalOps === null ? '—' : formatOps(proof.totalOps)}
              </dd>
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
          {proof.lookupId && (
            <div className="hash">
              <span className="hash__label">region lookup id (key stored)</span>
              <code>{proof.lookupId}</code>
            </div>
          )}

          {proof.message && <p className="notice">{proof.message}</p>}
        </>
      )}

      <p className="legend__note">
        {`THIS MACHINE: HOP <= h${hopCeil} · SIDESTEP <= h${sidestepCeil}`}
        {cloud.limits && cloudMode !== 'off' ? ` · CLOUD: HOP <= h${cloud.limits.max_hop_height} · SIDESTEP <= h${cloud.limits.max_sidestep_height}` : ''}
      </p>
    </section>
  )
}
