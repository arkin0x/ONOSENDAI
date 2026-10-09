/**
 * KeyCompose.tsx: forging a key to hide (Keys and Chests B1 §3.1).
 *
 * The keypair is made the moment the composer opens, so its public key can be
 * read, copied and sealed to before the key is hidden anywhere. The secret is
 * never shown: it goes into the bag as the item's content at COMMIT, and a
 * copy of the key goes into your own LOOT then, marked forged by you. PLACE
 * KEY hands the key to the deploy (useShards `startDeployKey`), which happens
 * in BUILD mode at the build cursor like a message. A key whose deploy BUILD
 * mode had to end comes back into the composer that opens next.
 */

import { useEffect, useState } from 'react'
import { Explanation } from './Explanation'
import { nip19 } from 'nostr-tools'
import { forgeKey } from '../lib/chests'
import { MAX_ITEM_NAME, type KeyItem } from '../lib/hidden'
import { shortHex } from '../lib/time'
import { useBuilder } from '../store/useBuilder'
import { useShards } from '../store/useShards'

/** `onDone` runs on CANCEL and once the key has been handed to the deploy. */
export function KeyCompose({ onDone }: { onDone: () => void }): JSX.Element {
  // A key whose deploy ended under it comes back here, pair and name alike
  // (useBuilder `itemDraft`); read in the initializer and taken in an effect,
  // as the message composer does, since React may run an initializer twice.
  const [key, setKey] = useState<KeyItem>(() => {
    const draft = useBuilder.getState().itemDraft
    return draft?.type === 'key' ? draft.key : forgeKey('')
  })
  useEffect(() => { useBuilder.getState().takeItemDraft('key') }, [])
  const [copied, setCopied] = useState<string | null>(null)
  const npub = nip19.npubEncode(key.itemPubkey)

  const copy = (what: string, text: string): void => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(what)
      window.setTimeout(() => setCopied((c) => (c === what ? null : c)), 1200)
    })
  }
  const place = (): void => {
    const name = key.name.trim()
    if (!name) return
    useShards.getState().startDeployKey({ ...key, name, about: key.about.trim() })
    onDone()
  }

  return (
    <div className="shards__compose">
      <input
        className="avatars__input"
        value={key.name}
        onChange={(e) => setKey({ ...key, name: e.target.value.slice(0, MAX_ITEM_NAME) })}
        placeholder="Name the key"
        maxLength={MAX_ITEM_NAME}
        autoFocus
        aria-label="Key name"
      />
      <input
        className="avatars__input"
        value={key.about}
        onChange={(e) => setKey({ ...key, about: e.target.value.slice(0, 280) })}
        placeholder="A sentence about it (optional)"
        aria-label="About the key"
      />
      {/* The public half, two ways: what a chest is sealed to. The secret is never shown. */}
      <div className="compose__pubkey">
        <button className="lootd__copy" title={`${npub} (click to copy)`} onClick={() => copy('npub', npub)}>{copied === 'npub' ? 'copied' : shortHex(npub, 16, 10)}</button>
        {' · '}
        <button className="lootd__copy" title={`${key.itemPubkey} (click to copy)`} onClick={() => copy('hex', key.itemPubkey)}>{copied === 'hex' ? 'copied' : shortHex(key.itemPubkey, 12, 8)}</button>
      </div>
      <div className="shards__actions">
        <button className="avatars__go" onClick={onDone}>CANCEL</button>
        <button className="avatars__go" disabled={!key.name.trim()} onClick={place} title="Aim it at the build cursor; the key goes into your LOOT when it is hidden">PLACE KEY ▸</button>
      </div>
      <Explanation>
        A key is a keypair hidden as an item: whoever reads it holds it, and it lands in their LOOT. Seal a chest to it and only a holder can open that chest. A mini quest is four steps: forge a key, hide it somewhere, seal a chest to it with a prize inside, and hide the chest somewhere else.
      </Explanation>
    </div>
  )
}
