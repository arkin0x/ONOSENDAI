/**
 * SecretsModal.tsx — every region you can open.
 *
 * A key is a number you computed, not a password you were given: the Cantor
 * root of one aligned region, hashed for the key and again for the lookup id
 * the relay knows it by (spec §7.2). This is the list of those, what each one
 * covers, where it came from, and what it costs to keep.
 *
 * Keys are not hierarchical: holding a region a mile wide says nothing about
 * the block inside it. So the list is flat, and forgetting one is not a loss
 * you cannot undo, since standing there again recomputes it. Anything a key
 * has already opened stays in the Stash whatever happens here.
 */

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { KeyRound } from 'lucide-react'
import { formatCellSize } from '../lib/scale'
import { formatAgo } from '../lib/time'
import { useCyberspace } from '../store/useCyberspace'
import { useSecrets, bytesOf, heldList, type HeldKey } from '../store/useSecrets'
import { useShards } from '../store/useShards'
import { ConfirmModal } from './ConfirmModal'
import { Explanation } from './Explanation'

/** The green of "found here", as everywhere else keys are drawn. */
export function SecretsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const keys = useSecrets((s) => s.keys)
  const discovered = useShards((s) => s.discovered)
  const showSecrets = useCyberspace((s) => s.showSecrets)
  const [forgetAll, setForgetAll] = useState(false)

  const list = useMemo(() => heldList(keys), [keys])
  const bytes = useMemo(() => list.reduce((n, k) => n + bytesOf(k), 0), [list])
  const now = Math.floor(Date.now() / 1000)

  // What each region has actually yielded, so a key that opened something says so.
  const opened = useMemo(() => {
    const by = new Map<string, number>()
    for (const h of Object.values(discovered)) {
      if (!h.lookupId) continue
      by.set(h.lookupId, (by.get(h.lookupId) ?? 0) + 1)
    }
    return by
  }, [discovered])

  const go = (k: HeldKey): void => {
    // The region's own corner, in its own plane, at a scale where it fits.
    const at = { x: BigInt(k.base.x), y: BigInt(k.base.y), z: BigInt(k.base.z) }
    onClose()
    useCyberspace.getState().focusOn(at, k.plane, `REGION 2^${k.height}`, Math.max(0, k.height - 4))
  }

  return createPortal(
    <div className="modal" role="dialog" aria-label="Secrets" aria-modal="true" onPointerDown={onClose}>
      <div className="modal__card secrets__box" onPointerDown={(e) => e.stopPropagation()}>
        <header className="panel__head">
          <h2><KeyRound size={14} strokeWidth={2.25} aria-hidden /> Secrets</h2>
          <span className="tag">{list.length === 0 ? 'NO KEYS' : `${list.length} REGION${list.length === 1 ? '' : 'S'}`}</span>
        </header>

        <div className="secrets__summary">
          <span>{formatBytes(bytes)} on this device</span>
          <label className="secrets__toggle">
            <input
              type="checkbox"
              checked={showSecrets}
              onChange={(e) => useCyberspace.getState().setShowSecrets(e.target.checked)}
            />
            Draw them in the scene
          </label>
        </div>

        <ul className="secrets__list">
          {list.map((k) => {
            const found = opened.get(k.lookupId) ?? 0
            return (
              <li key={k.lookupId} className="secrets__row">
                <button className="secrets__go" onClick={() => go(k)} title="Look at this region">
                  <span className="secrets__where">
                    <KeyRound size={11} strokeWidth={2.25} aria-hidden />
                    2^{k.height} · {formatCellSize(k.height)}
                  </span>
                  <span className="secrets__meta">
                    {k.plane === 1 ? 'ideaspace' : 'dataspace'} · {k.source === 'cloud' ? 'HOSAKA' : 'scanned'} · {formatAgo(k.at, now)}
                    {found > 0 && <span className="secrets__found"> · {found} found</span>}
                  </span>
                  <span className="secrets__id">{k.lookupId.slice(0, 16)}…</span>
                </button>
                <button
                  className="secrets__scan"
                  onClick={() => { void useShards.getState().rescan(k.lookupId, k.keyHex) }}
                  title="Ask the relay what is hidden in this region now"
                >SCAN</button>
                <button
                  className="targets__remove"
                  onClick={() => useSecrets.getState().forget(k.lookupId)}
                  aria-label="Forget this key"
                  title="Forget this key. Standing there again computes it back."
                >✕</button>
              </li>
            )
          })}
          {list.length === 0 && (
            <li className="avatars__empty">
              No keys yet. Moving through cyberspace computes the regions you pass, and each one you compute is a region you can open.
            </li>
          )}
        </ul>

        <Explanation>
          A region key is the Cantor root of one aligned cube, hashed once for the
          key and twice for the address the relay files it under. Holding it lets
          you ask what is hidden there and read the answer, and it opens that cube
          alone: a key to a large region says nothing about the blocks inside it,
          because each has its own root. Your machine computes the small ones as
          you move; the large ones are what HOSAKA sells, since a cube of side
          2^20 is a million pairings per axis and one of side 2^27 is a hundred
          and thirty million.
        </Explanation>

        <div className="modal__actions">
          {list.length > 0 && <button className="avatars__go" onClick={() => setForgetAll(true)}>FORGET ALL</button>}
          <button className="avatars__go" onClick={onClose}>CLOSE</button>
        </div>
      </div>

      {forgetAll && (
        <ConfirmModal
          title={`Forget all ${list.length} keys?`}
          body="Anything they have already opened stays in your Stash. The keys themselves come back by standing in those regions again, except the ones HOSAKA computed, which would have to be bought again."
          confirmLabel="FORGET ALL"
          onConfirm={() => { useSecrets.getState().forgetAll(); setForgetAll(false) }}
          onCancel={() => setForgetAll(false)}
        />
      )}
    </div>,
    document.body,
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
