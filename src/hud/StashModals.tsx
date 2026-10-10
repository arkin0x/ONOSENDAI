/**
 * StashModals.tsx - the Stash's Models, Bags and Bag Contents modals, the
 * Builder's Hide a Message composer, and the Forge a Key and Seal a Chest
 * composers (Keys and Chests B1 §3.1).
 * State in hud/stash.ts; mounted once at the app root.
 */

import { createPortal } from 'react-dom'
import { formatCellSize } from 'sno-core/scale'
import { cashuLabel } from '../lib/cashu'
import { useShards, type MyDeployment } from '../store/useShards'
import { useCashu, cashuStateLabel } from './useCashu'
import { bagsOf, depName, goToDeployment, useStash, type Bag } from './stash'
import { PublishSwitch } from './PublishSwitch'
import { useEscape } from '../hooks/useEscape'
import { MessageCompose } from './MessageCompose'
import { KeyCompose } from './KeyCompose'
import { ChestCompose } from './ChestCompose'
import { ItemIcon, distinctKinds } from './ItemIcon'
import { PlaceObjectPicker } from './PlaceObjectPicker'
import { FeedList } from './FeedList'
import { Explanation } from './Explanation'
import { GitFork, Wrench } from 'lucide-react'
import type { FeedObject } from 'sno-core/feed'
import { useWorkshop } from '../store/useWorkshop'

export const BAG_EXPLAINER =
  'A bag is a collection of one or more messages, objects, or cashu tokens encrypted to (hidden at) a location. All users can see a bag exists but they have no information about where to find it. Bags are opened automatically by attempting decryption with all your collected Region Keys.'

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }): JSX.Element {
  // Escape closes it as a tap outside does (arkinox, 2026-10-01). One Shell
  // serves all three views, so moving between them keeps its place.
  useEscape('modal', true, onClose)
  return createPortal(
    <div className="modal" role="dialog" aria-modal="true" aria-label={title} onPointerDown={onClose}>
      <div className="modal__card login stash-modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="login__head">
          <h2 className="modal__title">{title}</h2>
          <button className="secret__close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** One bag as a row: what is in it, how big a region it is sealed to, whether it is out. */
export function BagRow({ bag, onOpen }: { bag: Bag; onOpen: () => void }): JSX.Element {
  // One icon per kind in the bag, the oldest item's kind first; how many
  // items there are is on the line below.
  const kinds = distinctKinds(bag.items.map((d) => ({ type: d.type, coin: d.type === 'message' && /cashu[AB]/.test(d.text ?? '') })))
  const first = depName(bag.items[0])
  return (
    <li className="shards__row shards__row--deployed">
      <button className="shards__goto" onClick={onOpen} title="See what is in this bag">
        <span className="avatars__who">
          <span className="shards__type shards__type--bag">{kinds.map((k) => <ItemIcon key={`${k.type}:${k.coin}`} type={k.type} coin={k.coin} size={12} />)}</span>
          {bag.items.length === 1 ? first : `${first} + ${bag.items.length - 1} more`}
        </span>
        <span className="shards__meta">
          {bag.height === 0 ? 'exact gibson' : formatCellSize(bag.height)} · {bag.items.length} item{bag.items.length === 1 ? '' : 's'} · {bag.published ? 'LIVE' : 'LOCAL'}{bag.plane === 1 ? ' · ideaspace' : ''}
        </span>
      </button>
      <span className="shards__goto-hint" aria-hidden="true">▸</span>
    </li>
  )
}

function ItemRow({ d, onGo }: { d: MyDeployment; onGo: () => void }): JSX.Element {
  const cashu = useCashu(d.type === 'message' ? d.text : null)
  const coin = cashu.found
  return (
    <li className="shards__row shards__row--deployed">
      <button className="shards__goto" onClick={onGo} title="Fly to it and see its record">
        <span className="avatars__who">
          <ItemIcon className={`shards__type shards__type--${coin ? 'cashu' : d.type}`} type={d.type} coin={coin} size={12} />
          {coin ? (cashu.token ? cashuLabel(cashu.token) : 'cashu token') : depName(d)}
        </span>
        <span className="shards__meta">
          {d.type === 'message' ? (coin ? 'cashu token' : 'message') : d.type === 'shard' ? 'object' : d.type}{d.published ? ' · LIVE' : ' · LOCAL'}
          {coin && <> · <span className={`shards__cashu shards__cashu--${cashu.state}`}>{cashuStateLabel(cashu.state)}</span></>}
        </span>
      </button>
      {!d.published && <PublishSwitch lookupId={d.lookupId} published={false} />}
      <span className="shards__goto-hint" aria-hidden="true">▸</span>
    </li>
  )
}

/** The size of the icons on the feed's buttons, matched to their 8px capitals. */
const ICON = 12

/**
 * USE IN BUILDER and REMIX on a feed tile. ADD TO LIST arrives with SNO
 * lists (PR 4); a disabled button until then would only be noise.
 */
function FeedActions({ object }: { object: FeedObject }): JSX.Element {
  // BUILD starts where you are looking (ruling A), the object lined up as a
  // copy; a cancel comes back to this window.
  const use = (): void => useStash.getState().useFromFeed(object)
  const remix = (): void => {
    const id = useWorkshop.getState().importShard(object.shard, { address: object.address, relay: object.seen?.[0] })
    useStash.getState().close()
    useWorkshop.getState().openWorkshop(id)
  }
  return (
    <>
      <button className="feed__act" onClick={use} title="Place it at the build cursor, as a copy that credits its author"><Wrench size={ICON} strokeWidth={2.25} aria-hidden />USE IN BUILDER</button>
      <button className="feed__act" onClick={remix} title="Copy it into your workshop as your own, still credited"><GitFork size={ICON} strokeWidth={2.25} aria-hidden />REMIX</button>
    </>
  )
}

export function StashModals(): JSX.Element | null {
  const { models, bags, bag, message, key, chest, feed } = useStash()
  const mine = useShards((s) => s.mine)
  const close = useStash.getState().close
  const all = bagsOf(mine)

  if (bag !== null) {
    const b = all.find((x) => x.lookupId === bag)
    if (!b) return null
    return (
      <Shell title="Bag contents" onClose={close}>
        <p className="login__note">
          {b.items.length} item{b.items.length === 1 ? '' : 's'} sealed to {b.height === 0 ? 'one exact gibson' : `a ${formatCellSize(b.height)} region`}. Tap one to fly to it and see its record.
        </p>
        <ul className="avatars__list">
          {b.items.map((d) => <ItemRow key={d.eventId} d={d} onGo={() => { close(); goToDeployment(d) }} />)}
        </ul>
        <button className="secret__act login__act" onClick={() => useStash.getState().openBags()}>ALL BAGS</button>
      </Shell>
    )
  }
  if (bags) {
    return (
      <Shell title={`Stashed bags (${all.length})`} onClose={close}>
        <p className="login__note">{BAG_EXPLAINER}</p>
        {all.length === 0 ? <p className="login__note">Nothing hidden yet.</p> : (
          <ul className="avatars__list">
            {all.map((b) => <BagRow key={b.lookupId} bag={b} onOpen={() => useStash.getState().openBag(b.lookupId)} />)}
          </ul>
        )}
      </Shell>
    )
  }
  if (feed) {
    return (
      <Shell title="Shard Feed" onClose={close}>
        <FeedList actions={(o) => <FeedActions object={o} />} />
        <Explanation>
          Everyone&apos;s published objects, newest first. USE IN BUILDER puts one at the build cursor as a copy that credits its author (LIVE LINK on the deploy bar follows their edits instead). REMIX copies it into your workshop as your own, still credited.
        </Explanation>
      </Shell>
    )
  }
  if (message) {
    return (
      <Shell title="Hide a message" onClose={close}>
        <p className="login__note">Write the message, then aim it: it lands at the build cursor, and the bar that comes next sets how far away someone can be and still find it. Building does not move your avatar.</p>
        <MessageCompose onDone={close} />
      </Shell>
    )
  }
  // No paragraph on either: what an item or a chest is lives in the tooltips
  // and the ITEMS panel's EXPLAIN (the standing rule).
  if (key) {
    return (
      <Shell title="Forge an item" onClose={close}>
        <KeyCompose onDone={close} />
      </Shell>
    )
  }
  if (chest) {
    return (
      <Shell title="Seal a chest" onClose={close}>
        <ChestCompose onDone={close} />
      </Shell>
    )
  }
  if (models) {
    return (
      <Shell title="Place an object" onClose={close}>
        <PlaceObjectPicker />
      </Shell>
    )
  }
  return null
}
