/**
 * DeploymentDetail.tsx — a deployed thing, on the wire.
 *
 * Opened by tapping a row in the Stash panel, which also flies the scene to
 * where it sits. This is the record that lives on relays: its event id, which
 * relays hold it, the lookup id it is filed under, its coordinate, the height
 * it is hidden at, and what it is (a shard or a message). TEST DISCOVERY proves
 * the round-trip: it derives the region key fresh from the coordinate, as a
 * stranger would, asks the relay, and opens what comes back. DELETE FROM
 * CYBERSPACE sends a NIP-09 deletion; for a shard that removes the instance,
 * not the model it was made from.
 */

import { useEffect, useState } from 'react'
import { formatCellSize } from 'sno-core/scale'
import { messagePreview, shardRefusal } from '../lib/hidden'
import { shortHex } from '../lib/time'
import { ConfirmModal } from './ConfirmModal'
import { Comments } from './Comments'
import { itemTargetOf } from '../lib/comments'
import { useCyberspace } from '../store/useCyberspace'
import { positionOf, useShards } from '../store/useShards'
import { PublishSwitch } from './PublishSwitch'

function Field({ label, value, full }: { label: string; value: string; full?: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void navigator.clipboard?.writeText(full ?? value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200) }).catch(() => {})
  }
  return (
    <div className="detail__field">
      <span className="detail__key">{label}</span>
      <button className="detail__val" title={`${full ?? value} (click to copy)`} onClick={copy}>{copied ? 'copied' : value}</button>
    </div>
  )
}

export function DeploymentDetail(): JSX.Element | null {
  const inspecting = useShards((s) => s.inspecting)
  const me = useCyberspace((s) => s.identity.pubkey)
  const dep = useShards((s) => s.mine.find((d) => d.eventId === s.inspecting) ?? null)
  const [confirm, setConfirm] = useState(false)
  const [test, setTest] = useState<'idle' | 'testing' | 'found' | 'missing' | 'refused'>('idle')

  useEffect(() => { if (inspecting && !dep) useShards.getState().inspect(null) }, [inspecting, dep])
  useEffect(() => { setTest('idle') }, [inspecting])

  if (!dep) return null

  const isMessage = dep.type === 'message'
  const name = isMessage ? messagePreview(dep.text ?? '', 22) : dep.shard?.name ?? 'shard'
  const exit = (): void => { useShards.getState().inspect(null); useCyberspace.getState().clearFocus() }
  const runTest = async (): Promise<void> => {
    setTest('testing')
    setTest(await useShards.getState().testDiscovery(dep.eventId))
  }
  // Why the format refuses it, when it does: the same words the deploy bar
  // would have used, so the fix is named here too.
  const refusal = test === 'refused' && dep.shard ? shardRefusal(dep.shard) : null

  return (
    <div className="detail" role="dialog" aria-label={`Deployment ${name}`}>
      <div className="detail__head">
        <span className="detail__eye" aria-hidden="true">{isMessage ? '✎' : '◇'}</span>
        <span className="detail__title">VIEWING <strong>{name}</strong></span>
        <button className="detail__exit" onClick={exit}>EXIT</button>
      </div>

      {isMessage && <div className="detail__message">“{dep.text}”</div>}

      <div className="detail__grid">
        <Field label="kind" value={isMessage ? 'message (kind 1)' : dep.ref ? 'shard (kind 33331, by reference)' : 'shard (kind 3330)'} />
        <Field label="event" value={shortHex(dep.eventId, 10, 8)} full={dep.eventId} />
        <Field label="lookup" value={shortHex(dep.lookupId, 10, 8)} full={dep.lookupId} />
        <Field label="coord" value={`${shortHex(dep.at.x, 6, 4)} / ${shortHex(dep.at.y, 6, 4)} / ${shortHex(dep.at.z, 6, 4)}`} full={`${dep.at.x}\n${dep.at.y}\n${dep.at.z}`} />
        <div className="detail__field">
          <span className="detail__key">hidden</span>
          <span className="detail__plain">{dep.height === 0 ? 'exact gibson (height 0)' : `within ${formatCellSize(dep.height)} (height ${dep.height})`}</span>
        </div>
        <div className="detail__field detail__field--relays">
          <span className="detail__key">relays</span>
          <span className="detail__plain">{dep.published ? dep.relays.map((r) => r.replace('wss://', '')).join(', ') : 'nowhere yet: signed and kept on this device'}</span>
        </div>
        <div className="detail__field detail__field--relays">
          <span className="detail__key">published</span>
          <PublishSwitch lookupId={dep.lookupId} published={dep.published} />
        </div>

      </div>

      {dep.published && (
        <button className={`detail__test detail__test--${test}`} onClick={() => void runTest()} disabled={test === 'testing'}>
          {test === 'idle' && 'TEST DISCOVERY'}
          {test === 'testing' && 'DERIVING REGION KEY…'}
          {test === 'found' && '✓ FOUND & OPENED FROM THE RELAY'}
          {test === 'missing' && '✗ NOT FOUND — TAP TO RETRY'}
          {test === 'refused' && '✗ ON THE RELAY, BUT NO CLIENT CAN OPEN IT'}
        </button>
      )}
      {test === 'refused' && (
        <p className="detail__refusal">
          The bag is there and this item is in it, signed, but the format refuses it, so every client drops it and only this device shows it.
          {refusal ? ` ${refusal}` : ''} Fix it in the workshop and hide it again; DELETE removes this copy.
        </p>
      )}

      <Comments subject={{ author: me, lookupId: dep.lookupId, itemId: dep.eventId, type: dep.type, target: itemTargetOf(dep.inner, dep.ref), at: positionOf(dep), height: dep.height }} />

      <button className="detail__delete" onClick={() => setConfirm(true)}>DELETE FROM CYBERSPACE</button>

      {confirm && (
        <ConfirmModal
          title={`Delete this ${isMessage ? 'message' : 'shard instance'}?`}
          body={dep.published
            ? `A deletion request goes to ${dep.relays.map((r) => r.replace('wss://', '')).join(', ')}, and this device stops showing it and re-finding it.${isMessage ? '' : ` The "${dep.shard?.name}" model in your workshop is untouched — this removes only this deployed copy.`}`
            : `This was never published, so it only exists here.${isMessage ? '' : ` Removing it leaves the "${dep.shard?.name}" model in your workshop untouched.`}`}
          confirmLabel={isMessage ? 'DELETE MESSAGE' : 'DELETE INSTANCE'}
          onConfirm={() => { setConfirm(false); void useShards.getState().deleteInstance(dep.eventId) }}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  )
}
