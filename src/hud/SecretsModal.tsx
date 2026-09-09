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
import { sizeLabel } from '../scene/SecretRegions'
import { SCAN_MAX_HEIGHT, useShards } from '../store/useShards'
import { ConfirmModal } from './ConfirmModal'
import { Explanation } from './Explanation'

/** The green of "found here", as everywhere else keys are drawn. */
export function SecretsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const keys = useSecrets((s) => s.keys)
  const discovered = useShards((s) => s.discovered)
  const showSecrets = useCyberspace((s) => s.showSecrets)
  const [forgetAll, setForgetAll] = useState(false)
  const [scanning, setScanning] = useState<string | null>(null)
  const [scanned, setScanned] = useState<Record<string, number>>({})

  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const limits = useCyberspace((s) => s.cloud.limits)
  const provider = useCyberspace((s) => s.cloud.provider)
  const cloudOff = useCyberspace((s) => s.cloudPrefs.mode === 'off')
  const buying = useSecrets((s) => s.buying)
  const buyError = useSecrets((s) => s.buyError)

  // Above what this machine sweeps for itself, up to what HOSAKA computes.
  const lowest = SCAN_MAX_HEIGHT + 1
  const highest = limits?.max_hop_height ?? lowest
  const canBuy = !cloudOff && highest >= lowest
  const [buyHeight, setBuyHeight] = useState(Math.min(highest, lowest + 4))
  const price = useMemo(() => {
    const ladder = provider?.pricing?.hop
    if (!ladder) return null
    const band = [...ladder].sort((a, b) => a.max_height - b.max_height).find((x) => buyHeight <= x.max_height)
    return band?.sats ?? null
  }, [provider, buyHeight])

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
    // The middle of the region, not its corner: looking at a corner puts the
    // thing you asked about at the edge of the screen and everything else in
    // the middle. Half a side along each axis, per axis, because a movement's
    // region is a box.
    const mid = (axis: 'x' | 'y' | 'z'): bigint => {
      const h = BigInt(k.heights ? k.heights[axis] : k.height)
      return BigInt(k.base[axis]) + (1n << h) / 2n
    }
    useSecrets.getState().setOpen(false)
    useSecrets.getState().focus(k.lookupId)
    useCyberspace.getState().focusOn({ x: mid('x'), y: mid('y'), z: mid('z') }, k.plane, `REGION ${sizeLabel(k)}`, Math.max(0, k.height - 3))
  }

  return createPortal(
    <div className="modal" role="dialog" aria-label="Secrets" aria-modal="true" onPointerDown={onClose}>
      <div className="modal__card secrets__box" onPointerDown={(e) => e.stopPropagation()}>
        <header className="panel__head secrets__head">
          <h2><KeyRound size={14} strokeWidth={2.25} aria-hidden /> Secrets</h2>
          <span className="tag">{list.length === 0 ? 'NO KEYS' : `${list.length} REGION${list.length === 1 ? '' : 'S'}`}</span>
          <button className="targets__remove secrets__close" onClick={onClose} aria-label="Close" title="Close">✕</button>
        </header>

        <div className="secrets__summary">
          <span>{formatBytes(bytes)} on this device</span>
          {list.length > 0 && <button className="secrets__forget-all" onClick={() => setForgetAll(true)}>FORGET ALL</button>}
          <span className="secrets__gap" />
          <label className="secrets__toggle">
            <input
              type="checkbox"
              checked={showSecrets}
              onChange={(e) => useCyberspace.getState().setShowSecrets(e.target.checked)}
            />
            Draw them in the scene
          </label>
        </div>

        {/* The heights this machine cannot reach for itself. A cube of side
            2^12 it computes as you walk; 2^20 is a million pairings an axis. */}
        {canBuy && (
          <div className="secrets__buy">
            <span className="login__label">Buy a key where you stand</span>
            <div className="secrets__buy-row">
              <button className="secrets__step" disabled={!!buying || buyHeight <= lowest} onClick={() => setBuyHeight((h) => Math.max(lowest, h - 1))} aria-label="Smaller region">−</button>
              <span className="secrets__buy-size">2^{buyHeight} · {formatCellSize(buyHeight)}</span>
              <button className="secrets__step" disabled={!!buying || buyHeight >= highest} onClick={() => setBuyHeight((h) => Math.min(highest, h + 1))} aria-label="Larger region">+</button>
              <button
                className="avatars__go secrets__buy-go"
                disabled={!!buying}
                onClick={() => { void useSecrets.getState().buy(anchor, anchorPlane, buyHeight) }}
              >{buying ? (buying.status === 'submitting' ? 'ASKING' : 'COMPUTING') : `BUY${price !== null ? ` · ${price} SATS` : ''}`}</button>
            </div>
            <span className="cloud__profile-note">
              {buying
                ? `HOSAKA is computing the 2^${buying.height} cube around you. It lands in this list when it is done.`
                : `Three axis trees at 2^${buyHeight}, which is a hop's work at that height and is priced as one. Paid from your HOSAKA balance.`}
            </span>
            {buyError && <span className="secrets__error">{buyError}</span>}
          </div>
        )}

        <ul className="secrets__list">
          {list.map((k) => {
            const found = opened.get(k.lookupId) ?? 0
            return (
              <li key={k.lookupId} className="secrets__row">
                <button className="secrets__go" onClick={() => go(k)} title="Look at this region">
                  <span className="secrets__where">
                    <KeyRound size={11} strokeWidth={2.25} aria-hidden />
                    {sizeLabel(k)}
                  </span>
                  {/* Every side, in real units: a region is a volume and one
                      number could only ever be one of its edges. */}
                  <span className="secrets__dims">{physicalSize(k)}</span>
                  <span className="secrets__meta">
                    {k.plane === 1 ? 'ideaspace' : 'dataspace'} · {k.source === 'cloud' ? 'bought' : k.source === 'hop' ? 'crossed' : 'opened'} · {formatAgo(k.at, now)}
                    {found > 0 && <span className="secrets__found"> · {found} found</span>}
                  </span>
                  <span className="secrets__id">{k.lookupId.slice(0, 16)}…</span>
                </button>
                <button
                  className="secrets__scan"
                  disabled={scanning === k.lookupId}
                  onClick={() => {
                    setScanning(k.lookupId)
                    void useShards.getState().rescan(k.lookupId, k.keyHex).then((n) => {
                      setScanning(null)
                      setScanned((prev) => ({ ...prev, [k.lookupId]: n }))
                      window.setTimeout(() => setScanned((prev) => { const next = { ...prev }; delete next[k.lookupId]; return next }), 6000)
                    })
                  }}
                  title="Ask the relay what is hidden in this region now"
                >{scanning === k.lookupId ? '…' : scanned[k.lookupId] !== undefined ? (scanned[k.lookupId] > 0 ? `+${scanned[k.lookupId]}` : 'NONE') : 'SCAN'}</button>
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
              Nothing opened yet. A key is kept when it opens something where you stand, or when you buy one; the regions you merely pass through cost milliseconds to compute again and are not listed.
            </li>
          )}
        </ul>

        <Explanation>
          A region key is the Cantor root of one aligned cube, hashed once for the
          key and twice for the address the relay files it under. Holding it lets
          you ask what is hidden there and read the answer, and it opens that cube
          alone: a key to a large region says nothing about the blocks inside it,
          because each has its own root. Your machine computes the small cubes
          around you as you move, so those are not kept; a key earns its place
          here by opening something, or by being bought. The large ones are what
          HOSAKA sells, since a cube of side 2^20 is a million pairings per axis
          and one of side 2^27 is a hundred and thirty million.
        </Explanation>


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

/** Every side of the region in real units, so "how big" has a whole answer. */
function physicalSize(k: HeldKey): string {
  if (!k.heights || (k.heights.x === k.heights.y && k.heights.y === k.heights.z)) {
    return `${formatCellSize(k.height)} on every side`
  }
  return `${formatCellSize(k.heights.x)} × ${formatCellSize(k.heights.y)} × ${formatCellSize(k.heights.z)}`
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
