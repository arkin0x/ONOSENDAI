/**
 * KeyCompose.tsx: forging an item to hide (Keys and Chests B1 §3.1).
 *
 * An item is a keypair (arkinox, 2026-10-10: "keys ARE items"; a key is only
 * the role an item plays when a chest is sealed to it). The keypair is made
 * the moment the composer opens, so its public key can be read, copied and
 * sealed to before the item is hidden anywhere. The secret is never shown: it
 * goes into the bag in the item's `secret` tag at COMMIT. Hiding it does not
 * hold it (arkinox, 2026-11-06): TAKE on it picks it up into your ITEMS,
 * marked forged by you. PLACE ITEM hands the item to the deploy (useShards
 * `startDeployKey`), which happens in BUILD mode at the build cursor like a
 * message. An item whose deploy BUILD mode had to end comes back into the
 * composer that opens next.
 *
 * The fields (name, sentence, PICTURE, MODEL and its motions) are
 * ItemForgeFields, shared with the chest composer's FORGE NEW.
 */

import { useEffect, useState } from 'react'
import { Explanation } from './Explanation'
import { forgeKey } from '../lib/chests'
import type { KeyItem } from '../lib/hidden'
import { useBuilder } from '../store/useBuilder'
import { useShards } from '../store/useShards'
import { ItemForgeFields } from './ItemForgeFields'

/** `onDone` runs on CANCEL and once the item has been handed to the deploy. */
export function KeyCompose({ onDone }: { onDone: () => void }): JSX.Element {
  // An item whose deploy ended under it comes back here, pair, name and
  // picture alike (useBuilder `itemDraft`); read in the initializer and taken
  // in an effect, as the message composer does, since React may run an
  // initializer twice.
  const [key, setKey] = useState<KeyItem>(() => {
    const draft = useBuilder.getState().itemDraft
    return draft?.type === 'key' ? draft.key : forgeKey('')
  })
  useEffect(() => { useBuilder.getState().takeItemDraft('key') }, [])
  const place = (): void => {
    const name = key.name.trim()
    if (!name) return
    useShards.getState().startDeployKey({ ...key, name, about: key.about.trim() })
    onDone()
  }

  return (
    <div className="shards__compose">
      <ItemForgeFields item={key} onChange={setKey} />
      <div className="shards__actions">
        <button className="avatars__go" onClick={onDone}>CANCEL</button>
        <button className="avatars__go" disabled={!key.name.trim()} onClick={place} title="Aim it at the build cursor; the item goes into your ITEMS when it is hidden">PLACE ITEM ▸</button>
      </div>
      <Explanation>
        An item is a keypair hidden in a bag: whoever finds it can TAKE it into their ITEMS. Seal a chest to it and only a holder can open that chest. A mini quest is four steps: forge an item, hide it somewhere, seal a chest to it with a prize inside, and hide the chest somewhere else.
      </Explanation>
    </div>
  )
}
