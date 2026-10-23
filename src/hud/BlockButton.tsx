/**
 * BlockButton.tsx - BLOCK AUTHOR and MUTE THIS ITEM, wherever an author or a
 * found thing is shown (arkinox, 2026-10-23: "a block button so that that
 * audio can be muted or the author can be blocked entirely").
 *
 * Both write the person's NIP-51 mute list (store/useMutes), and only on
 * this tap: a block is published, so nothing else ever calls it. The same
 * button turns into UNBLOCK / UNMUTE, so a block is never a trap. What
 * happened is said in a toast, since the card it was tapped on usually
 * closes (the thing it showed is hidden now).
 */

import { useState } from 'react'
import { Ban, CircleSlash, Undo2 } from 'lucide-react'
import { useCyberspace } from '../store/useCyberspace'
import { useMutes, type EditResult } from '../store/useMutes'
import { useToast, BRIEF_TOAST_MS } from '../store/useToast'

const ICON = 13

function say(result: EditResult, done: string, meta: string): void {
  if (result.ok) useToast.getState().show({ label: done, meta, mark: 'block', ms: BRIEF_TOAST_MS })
  else useToast.getState().show({ label: 'MUTE LIST NOT CHANGED', meta: result.reason, mark: 'block' })
}

/**
 * Why the last tap changed nothing, on the card itself: a toast sits under
 * an open card's backdrop. A full row of the card's actions, so it reads
 * under the buttons.
 */
function Refusal({ text }: { text: string | null }): JSX.Element | null {
  return text ? <span className="secret__status block__refusal" role="status">{text}</span> : null
}

/** BLOCK AUTHOR / UNBLOCK for one pubkey. Nothing for your own. */
export function BlockButton({ pubkey, onBlocked, label = 'BLOCK AUTHOR' }: { pubkey: string; onBlocked?: () => void; label?: string }): JSX.Element | null {
  const me = useCyberspace((s) => s.identity.pubkey)
  const blocked = useMutes((s) => s.muted.pubkeys.has(pubkey))
  const busy = useMutes((s) => s.busy)
  const [refusal, setRefusal] = useState<string | null>(null)
  if (!pubkey || pubkey === me) return null
  const tap = async (): Promise<void> => {
    if (busy) return
    setRefusal(null)
    const result = blocked ? await useMutes.getState().unblock(pubkey) : await useMutes.getState().block(pubkey)
    if (blocked) say(result, 'UNBLOCKED', 'Their things show again.')
    else say(result, 'BLOCKED', 'Their shards, items and avatar are hidden. UNBLOCK in Identity.')
    if (!result.ok) setRefusal(result.reason)
    else if (!blocked) onBlocked?.()
  }
  return (
    <>
    <button
      className={`secret__act${blocked ? '' : ' secret__act--danger'}`}
      onClick={() => void tap()}
      disabled={busy}
      title={blocked ? 'Remove them from your mute list' : 'Hide everything by them, on your mute list (private)'}
    >
      {blocked ? <Undo2 size={ICON} strokeWidth={2.25} aria-hidden /> : <Ban size={ICON} strokeWidth={2.25} aria-hidden />}
      {busy ? 'SIGNING…' : blocked ? 'UNBLOCK' : label}
    </button>
    <Refusal text={refusal} />
    </>
  )
}

/** MUTE THIS ITEM / UNMUTE for one item's event id. */
export function MuteItemButton({ id, onMuted, label = 'MUTE THIS ITEM' }: { id: string; onMuted?: () => void; label?: string }): JSX.Element | null {
  const muted = useMutes((s) => s.muted.items.has(id))
  const busy = useMutes((s) => s.busy)
  const [refusal, setRefusal] = useState<string | null>(null)
  if (!id) return null
  const tap = async (): Promise<void> => {
    if (busy) return
    setRefusal(null)
    const result = muted ? await useMutes.getState().unmuteItem(id) : await useMutes.getState().muteItem(id)
    if (muted) say(result, 'UNMUTED', 'It shows again.')
    else say(result, 'MUTED', 'Hidden on your mute list (private).')
    if (!result.ok) setRefusal(result.reason)
    else if (!muted) onMuted?.()
  }
  return (
    <>
    <button className="secret__act" onClick={() => void tap()} disabled={busy} title={muted ? 'Remove it from your mute list' : 'Hide this one thing, on your mute list (private)'}>
      {muted ? <Undo2 size={ICON} strokeWidth={2.25} aria-hidden /> : <CircleSlash size={ICON} strokeWidth={2.25} aria-hidden />}
      {busy ? 'SIGNING…' : muted ? 'UNMUTE' : label}
    </button>
    <Refusal text={refusal} />
    </>
  )
}
