/**
 * DeploymentDetail.tsx — a deployed instance, on the wire.
 *
 * Opened by tapping a row in the Shards panel, which also flies the scene to
 * where the shard sits. This is the record that lives on relays: its event id,
 * which relays hold it, the lookup id it is filed under, its coordinate, and
 * the height it is hidden at. DELETE FROM CYBERSPACE sends a NIP-09 deletion to
 * exactly those relays and drops it here; that removes the instance, not the
 * model it was made from, which stays in the workshop.
 */

import { useEffect, useState } from 'react'
import { formatCellSize } from '../lib/scale'
import { shortHex } from '../lib/time'
import { ConfirmModal } from './ConfirmModal'
import { useCyberspace } from '../store/useCyberspace'
import { useShards } from '../store/useShards'

function Field({ label, value, full }: { label: string; value: string; full?: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    const text = full ?? value
    void navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200) }).catch(() => {})
  }
  return (
    <div className="detail__field">
      <span className="detail__key">{label}</span>
      <button className="detail__val" title={`${full ?? value} (click to copy)`} onClick={copy}>
        {copied ? 'copied' : value}
      </button>
    </div>
  )
}

export function DeploymentDetail(): JSX.Element | null {
  const inspecting = useShards((s) => s.inspecting)
  const dep = useShards((s) => s.mine.find((d) => d.eventId === s.inspecting) ?? null)
  const [confirm, setConfirm] = useState(false)

  // A deployment removed out from under the overlay closes it.
  useEffect(() => { if (inspecting && !dep) useShards.getState().inspect(null) }, [inspecting, dep])

  if (!dep) return null

  const exit = (): void => { useShards.getState().inspect(null); useCyberspace.getState().clearFocus() }

  return (
    <div className="detail" role="dialog" aria-label={`Deployment ${dep.shard.name}`}>
      <div className="detail__head">
        <span className="detail__eye" aria-hidden="true">◇</span>
        <span className="detail__title">VIEWING <strong>{dep.shard.name}</strong></span>
        <button className="detail__exit" onClick={exit}>EXIT</button>
      </div>

      <div className="detail__grid">
        <Field label="event" value={shortHex(dep.eventId, 10, 8)} full={dep.eventId} />
        <Field label="lookup" value={shortHex(dep.lookupId, 10, 8)} full={dep.lookupId} />
        <Field label="coord" value={`${shortHex(dep.at.x, 6, 4)} / ${shortHex(dep.at.y, 6, 4)} / ${shortHex(dep.at.z, 6, 4)}`} full={`${dep.at.x}\n${dep.at.y}\n${dep.at.z}`} />
        <div className="detail__field">
          <span className="detail__key">hidden</span>
          <span className="detail__plain">{dep.height === 0 ? 'exact gibson (height 0)' : `within ${formatCellSize(dep.height)} (height ${dep.height})`}</span>
        </div>
        <div className="detail__field">
          <span className="detail__key">plane</span>
          <span className="detail__plain">{dep.plane === 0 ? 'dataspace' : 'ideaspace'}</span>
        </div>
        <div className="detail__field detail__field--relays">
          <span className="detail__key">relays</span>
          <span className="detail__plain">
            {dep.published ? dep.relays.map((r) => r.replace('wss://', '')).join(', ') : 'local only — never published'}
          </span>
        </div>
      </div>

      <button className="detail__delete" onClick={() => setConfirm(true)}>DELETE FROM CYBERSPACE</button>

      {confirm && (
        <ConfirmModal
          title={`Delete this instance of ${dep.shard.name}?`}
          body={dep.published
            ? `A deletion request goes to ${dep.relays.map((r) => r.replace('wss://', '')).join(', ')}, and this device stops showing it and re-finding it. The "${dep.shard.name}" model in your workshop is untouched — this removes only this deployed copy.`
            : `This instance was never published, so it only exists here. Removing it leaves the "${dep.shard.name}" model in your workshop untouched.`}
          confirmLabel="DELETE INSTANCE"
          onConfirm={() => { setConfirm(false); void useShards.getState().deleteInstance(dep.eventId) }}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  )
}
