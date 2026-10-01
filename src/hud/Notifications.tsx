/**
 * Notifications.tsx: reactions and comments that tag you (arkinox, 2026-09-28).
 *
 * Three ways in, one modal:
 * - NOTIFICATIONS in the identity panel, with a pulsing red dot in its top
 *   right corner while anything is unread;
 * - a toast under XOR BITS while anything is unread, "🤙 (face) and N more…"
 *   (a speech-bubble icon in place of the emoji when the newest is a comment);
 * - the modal itself: every notification, newest first, loading older ones
 *   as you scroll, each saying who, what, and what it was on, with a button
 *   that goes there (the move's modal, your deployment, or the thread a
 *   reply was in).
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageCircle } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import type { Notification } from '../lib/notifications'
import { reactionGlyph } from '../lib/social'
import { parseAction } from '../lib/events'
import { COMMENT_KIND, PLACEHOLDER } from '../lib/comments'
import { relaysFor } from '../lib/inbox'
import { queryAny } from '../lib/relay'
import { formatAgo, formatStamp } from '../lib/time'
import { goToDeployment } from './stash'
import { useProfile } from '../hooks/useProfile'
import { profileLabel } from '../store/useProfiles'
import { useCyberspace } from '../store/useCyberspace'
import { useNotifications, POLL_MS } from '../store/useNotifications'
import { useShards } from '../store/useShards'
import { useSocialUi } from '../store/useSocialUi'
import { ProfilePic } from './ProfileBadge'
import { useEscape } from '../hooks/useEscape'

/**
 * The glyph a notification leads with: the reaction itself, or for words the
 * lucide speech bubble the chain explorer's COMMENTS button wears
 * (arkinox, 2026-09-28).
 */
function glyphOf(n: Notification): JSX.Element {
  if (n.what === 'comment') return <MessageCircle className="notif__icon" size={16} strokeWidth={2.25} aria-hidden />
  return n.image ? <img className="reactions__img" src={n.image} alt={n.content} /> : <>{reactionGlyph(n.content)}</>
}

function verbOf(n: Notification): string {
  // A target found nowhere is kept rather than missed, and said as a possibility.
  const on = n.on.type === 'action' ? 'your move' : n.on.type === 'item' ? (n.guessed ? 'what may be your hidden message' : 'your hidden item') : 'your comment'
  if (n.what === 'reaction') return `reacted to ${on}`
  return n.on.type === 'comment' ? 'replied to your comment' : `commented on ${on}`
}

/** Keeps the store fed while the app is open: the first page per identity, then a poll. */
export function useNotificationsLoop(): void {
  const me = useCyberspace((s) => s.identity.pubkey)
  useEffect(() => {
    void useNotifications.getState().start(me)
    const t = window.setInterval(() => void useNotifications.getState().poll(), POLL_MS)
    return () => window.clearInterval(t)
  }, [me])
}

/** The unread count, recomputed when the list or the seen mark moves. */
function useUnread(): number {
  return useNotifications((s) => s.items.filter((n) => n.createdAt > s.lastSeen).length)
}

/** NOTIFICATIONS, for the identity panel. */
export function NotificationsButton(): JSX.Element {
  const unread = useUnread()
  return (
    <button
      className="identity__change identity__notif"
      onClick={() => useNotifications.getState().setOpen(true)}
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
    >
      NOTIFICATIONS
      {unread > 0 && <span className="notif__dot" aria-hidden="true" />}
    </button>
  )
}

/** Under XOR BITS while anything is unread. */
export function NotificationsToast(): JSX.Element | null {
  const unread = useUnread()
  const latest = useNotifications((s) => s.items.find((n) => n.createdAt > s.lastSeen) ?? null)
  const profile = useProfile(latest?.from ?? null)
  if (!latest || unread === 0) return null
  const who = profileLabel(profile, nip19.npubEncode(latest.from))
  return (
    <button className="hyperbar notif__toast" onClick={() => useNotifications.getState().setOpen(true)} aria-label={`${unread} unread notifications. Tap to see.`}>
      <span className="notif__toast-glyph" aria-hidden="true">{glyphOf(latest)}</span>
      <ProfilePic pubkey={latest.from} size={22} />
      <span className="notif__toast-text">{unread > 1 ? `and ${unread - 1} more…` : `${who} ${verbOf(latest)}`}</span>
    </button>
  )
}

/** Fetch one event by id from your relays and inbox. */
async function fetchById(id: string): Promise<{ kind: number; tags: string[][] } | null> {
  const me = useCyberspace.getState().identity.pubkey
  const found = await queryAny(await relaysFor([me]), { ids: [id], limit: 1 })
  return found[0] ?? null
}

/** Open a move by its id: from the chain in hand when it is there, else from the relays. */
async function openMove(id: string): Promise<string | null> {
  const cs = useCyberspace.getState()
  const chain = cs.focusChain()
  const i = chain.findIndex((a) => a.id === id)
  if (i >= 0) {
    cs.explore(i === chain.length - 1 ? null : i)
    useSocialUi.getState().openAction(chain[i])
    return null
  }
  const raw = cs.events.find((e) => e.id === id) ?? (await fetchById(id))
  const action = raw ? parseAction(raw as Parameters<typeof parseAction>[0]) : null
  if (!action) return 'That move could not be found on any relay.'
  useSocialUi.getState().openAction(action)
  return null
}

/** Open one of your deployments by its item id, or by its bag. */
function openItem(id: string | null, lookupId?: string): string | null {
  const mine = useShards.getState().mine
  const dep = mine.find((d) => d.eventId === id) ?? (lookupId ? mine.find((d) => d.lookupId === lookupId) : undefined)
  if (!dep) return 'That item is not one this device hid, so it cannot be opened from here.'
  goToDeployment(dep)
  return null
}

/** Go to what a notification is about. Resolves to a reason when it cannot. */
async function view(n: Notification): Promise<string | null> {
  if (n.on.type === 'action') return openMove(n.on.id)
  if (n.on.type === 'item') return openItem(n.on.id, n.on.lookupId)
  // A reply or a reaction to your comment: go where that comment was made.
  const comment = await fetchById(n.on.id)
  if (!comment || comment.kind !== COMMENT_KIND) return 'That comment could not be found on any relay.'
  const rootKind = Number(comment.tags.find((t) => t[0] === 'K')?.[1])
  if (rootKind === 3333) {
    const root = comment.tags.find((t) => t[0] === 'E')?.[1]
    return root ? openMove(root) : 'That comment names no move.'
  }
  const bag = comment.tags.find((t) => t[0] === 'A')?.[1]
  return openItem(null, bag?.split(':')[2])
}

function Row({ n, words }: { n: Notification; words?: string }): JSX.Element {
  const profile = useProfile(n.from)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const who = profileLabel(profile, nip19.npubEncode(n.from))
  const go = async (): Promise<void> => {
    setBusy(true); setProblem(null)
    const why = await view(n)
    setBusy(false)
    if (why) setProblem(why)
    else useNotifications.getState().setOpen(false)
  }
  const text = n.what === 'comment' ? (n.sealed ? words ?? null : n.content) : null
  return (
    <li className="notif__row">
      <span className="notif__glyph" aria-hidden="true">{glyphOf(n)}</span>
      <div className="notif__main">
        <div className="notif__head">
          <ProfilePic pubkey={n.from} size={22} />
          <span className="notif__who">{who}</span>
          <span className="notif__when" title={formatStamp(n.createdAt)}>{formatAgo(n.createdAt)}</span>
        </div>
        <p className="notif__verb">{verbOf(n)}</p>
        {n.what === 'comment' && (
          text
            ? <p className="notif__words">{text}</p>
            : <p className="notif__words notif__words--sealed">{n.sealed ? 'Sealed to the place it answers: go there to read it.' : PLACEHOLDER}</p>
        )}
        <button className="secret__act notif__view" disabled={busy} onClick={() => void go()}>
          {busy ? 'OPENING…' : n.on.type === 'action' ? 'VIEW MOVE' : n.on.type === 'item' ? 'VIEW ITEM' : 'VIEW THREAD'}
        </button>
        {problem && <p className="comments__error">{problem}</p>}
      </div>
    </li>
  )
}

/** Every notification, newest first; older ones load as the end of the list comes into view. */
export function NotificationsModal(): JSX.Element | null {
  const open = useNotifications((s) => s.open)
  const items = useNotifications((s) => s.items)
  const opened = useNotifications((s) => s.opened)
  const loading = useNotifications((s) => s.loading)
  const done = useNotifications((s) => s.done)
  const list = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !end.current) return
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void useNotifications.getState().loadMore()
    }, { root: list.current, rootMargin: '200px' })
    seen.observe(end.current)
    return () => seen.disconnect()
  }, [open, items.length])
  // Escape closes it as a tap outside does (arkinox, 2026-10-01).
  useEscape('modal', open, () => useNotifications.getState().setOpen(false))

  if (!open) return null
  const close = (): void => useNotifications.getState().setOpen(false)
  return createPortal(
    <div className="modal modal--top" role="dialog" aria-modal="true" aria-label="Notifications" onPointerDown={close}>
      <div className="modal__card secret notif" onPointerDown={(e) => e.stopPropagation()}>
        <div className="secret__head">
          <span className="secret__label notif__title">NOTIFICATIONS</span>
          <button className="secret__close" onClick={close} aria-label="Close">✕</button>
        </div>
        <div className="notif__scroll" ref={list}>
          {items.length === 0 && !loading && <p className="comments__empty">Nothing yet. Reactions and comments on your moves and hidden items land here.</p>}
          <ul className="notif__list">
            {items.map((n) => <Row key={n.id} n={n} words={opened[n.id]} />)}
          </ul>
          <div ref={end} className="notif__end">{loading ? 'LOADING…' : done && items.length > 0 ? 'THAT IS EVERYTHING' : ''}</div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
