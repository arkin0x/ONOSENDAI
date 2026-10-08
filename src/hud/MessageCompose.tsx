/**
 * MessageCompose.tsx - writing a message to hide, before aiming it.
 *
 * One composer, used in two places: inline in the Stash panel, and in the
 * Builder's HIDE MESSAGE modal (StashModals). PLACE MESSAGE hands the text to
 * the deploy (useShards `startDeployMessage`), which happens in BUILD mode
 * at the build cursor (store/useBuilder.ts). A message whose deploy BUILD
 * mode had to end comes back into the composer that opens next.
 *
 * A Cashu token in the text is read, and its mint asked, only once the text
 * has held still for SETTLE_MS: not on every keystroke through a token
 * thousands of characters long. Until then PLACE MESSAGE waits.
 */

import { useEffect, useState } from 'react'
import { composeVerdict, SETTLE_MS, useCashu } from './useCashu'
import { useSettled } from './useSettled'
import { MAX_MESSAGE_LENGTH } from '../lib/hidden'
import { useShards } from '../store/useShards'
import { useBuilder } from '../store/useBuilder'

/** `onDone` runs on CANCEL and once the message has been handed to the deploy. */
export function MessageCompose({ onDone }: { onDone: () => void }): JSX.Element {
  // A message whose deploy ended under it (BUILD mode ended by the view
  // moving, or by your position being replaced) comes back here, so nothing
  // written is lost (useBuilder `messageDraft`). Read in the initializer and
  // taken in an effect: React may run an initializer twice in development.
  const [message, setMessage] = useState(() => useBuilder.getState().messageDraft ?? '')
  useEffect(() => { useBuilder.getState().takeMessageDraft() }, [])
  const settled = useSettled(message, SETTLE_MS) === message
  const cashu = useCashu(settled ? message : null)
  const verdict = composeVerdict(settled, cashu)

  const place = (): void => {
    const t = message.trim()
    if (!t) return
    useShards.getState().startDeployMessage(t)
    setMessage('')
    onDone()
  }

  return (
    <div className="shards__compose">
      <textarea
        className="shards__textarea"
        value={message}
        onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
        placeholder="A message left in cyberspace, readable only from where you place it…"
        rows={3}
        autoFocus
      />
      {verdict.note && <span className={`shards__compose-note shards__compose-note--${verdict.tone}`} role="status">{verdict.note}</span>}
      <div className="shards__actions">
        <button className="avatars__go" onClick={() => { setMessage(''); onDone() }}>CANCEL</button>
        <button className="avatars__go" disabled={!message.trim() || !verdict.ready} onClick={place}>PLACE MESSAGE ▸</button>
      </div>
    </div>
  )
}
