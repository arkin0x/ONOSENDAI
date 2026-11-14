/**
 * Notifications.tsx: reactions and comments that tag you (arkinox, 2026-09-28).
 *
 * Three ways in, one modal:
 * - NOTIFICATIONS in the identity panel, with a pulsing red dot in its top
 *   right corner while anything is unread;
 * - a toast under XOR BITS while anything is unread, "🤙 (face) and N more…"
 *   (a speech-bubble icon in place of the emoji when the newest is a comment);
 * - the modal itself: every notification, newest first, loading older ones
 *   as you scroll, each saying who, what, and what it was on, with one VIEW
 *   button that opens it and lands on what the notification is about: the
 *   comment, glowing, or the reactions (arkinox, 2026-11-14: "view thread,
 *   view shard, and view item seem like they should all be the same action").
 *   What VIEW opens stacks over this modal, which is there again when it
 *   closes (modalStack).
 * - New ones, not yet seen, carry the pulsing red dot and a brighter row
 *   while the modal is open; closing it marks them read (useNotifications).
 *
 * The toast also says when one of your agents sent you a private message you
 * have not opened (arkinox, 2026-10-11: "or just use the existing
 * notification toast"). That comes first, since an agent may be waiting on
 * an answer, and a tap opens that agent's conversation. Only who sent it is
 * shown, never the words: they are private, and on a shared screen.
 *
 * A local chat line that tags you is one too (arkinox, 2026-10-13: "a tag
 * should probably do something more significant"): "<name> tagged you: <the
 * line>", the line's own words since everyone standing there heard them, and
 * a tap opens the chat at that line. Chat is ephemeral, so these are made on
 * this device as the line arrives and kept there (useNotifications).
 */

import { BackupTrouble, RelayTrouble } from './RelayTrouble'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AtSign, MessageCircle, MessageSquare } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { itemToView, landingOf, publishedShardOnly, type Notification } from '../lib/notifications'
import { reactionGlyph } from '../lib/social'
import { parseAction } from '../lib/events'
import { COMMENT_KIND, PLACEHOLDER } from '../lib/comments'
import { SNO_KIND } from 'sno-core/feed'
import { relaysFor } from '../lib/inbox'
import { queryAny } from '../lib/relay'
import { formatAgo, formatStamp } from '../lib/time'
import { goToDeployment } from './stash'
import { useProfile } from '../hooks/useProfile'
import { profileLabel } from '../store/useProfiles'
import { useCyberspace } from '../store/useCyberspace'
import { walkChain } from '../store/useBuilder'
import { useNotifications, POLL_MS } from '../store/useNotifications'
import { useShards } from '../store/useShards'
import { useSocialUi } from '../store/useSocialUi'
import { ProfilePic, ProfileTap } from './ProfileBadge'
import { Stacked, leaveModals, useModalStack } from './modalStack'
import { useModalFocus } from '../store/useModalFocus'
import { openPublishedShard } from '../store/usePublicShard'
import { useAgentUnread } from '../hooks/useAgentDmWatch'
import { setTalking } from '../store/useAgentDms'
import { useChat } from '../store/useChat'
import { useProfiles } from '../store/useProfiles'
import { previewText } from '../lib/mentions'
import { useMutes } from '../store/useMutes'
import { hidesThing, type Muted } from '../lib/muteList'

/**
 * The glyph a notification leads with: the reaction itself, or for words the
 * lucide speech bubble the chain explorer's COMMENTS button wears
 * (arkinox, 2026-09-28).
 */
function glyphOf(n: Notification): JSX.Element {
  if (n.what === 'comment') return <MessageCircle className="notif__icon" size={16} strokeWidth={2.25} aria-hidden />
  if (n.what === 'mention') return <AtSign className="notif__icon" size={16} strokeWidth={2.25} aria-hidden />
  return n.image ? <img className="reactions__img" src={n.image} alt={n.content} /> : <>{reactionGlyph(n.content)}</>
}

/** A tag's chat line as words, every reference as @Name, cut for a toast or a row. */
function mentionWords(n: Notification, max = 60): string {
  const profiles = useProfiles.getState().profiles
  return previewText(n.content, (pk, npub) => profileLabel(profiles[pk], npub), max)
}

function verbOf(n: Notification): string {
  if (n.what === 'mention') return 'tagged you in local chat'
  // A shard you published and never hid here is seen in other clients' feeds,
  // and reacted to there: it is your shard, not a hidden item (2026-11-02).
  const shardOnly = publishedShardOnly(n.on, useShards.getState().mine, useCyberspace.getState().identity.pubkey)
  // A target found nowhere is kept rather than missed, and said as a possibility.
  const on = n.on.type === 'action' ? 'your move' : n.on.type === 'item' ? (shardOnly ? 'your shard' : n.guessed ? 'what may be your hidden message' : 'your hidden item') : 'your comment'
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

/** Whether a notification is from someone blocked, or is muted itself or by what it is on (store/useMutes). */
function mutedNote(n: Notification, muted: Muted): boolean {
  return hidesThing(muted, { authors: [n.from], ids: [n.id, n.on.id] })
}

/** The unread count, recomputed when the list or the seen mark moves. */
function useUnread(): number {
  const muted = useMutes((s) => s.muted)
  return useNotifications((s) => s.items.filter((n) => n.createdAt > s.lastSeen && !mutedNote(n, muted)).length)
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

/** Under XOR BITS while anything is unread: a message from one of your agents first, then reactions and comments. */
export function NotificationsToast(): JSX.Element | null {
  const unread = useUnread()
  const muted = useMutes((s) => s.muted)
  const latest = useNotifications((s) => s.items.find((n) => n.createdAt > s.lastSeen && !mutedNote(n, muted)) ?? null)
  const agentUnread = useAgentUnread()
  const agent = agentUnread.latest
  const profile = useProfile(agent ?? latest?.from ?? null)
  if (agent) {
    const who = profileLabel(profile, nip19.npubEncode(agent))
    const more = agentUnread.total - 1
    return (
      <button className="hyperbar notif__toast" onClick={() => setTalking(agent)} aria-label={`${agentUnread.total} unread from your agents. Tap to read.`}>
        <MessageSquare className="notif__toast-glyph notif__icon" size={16} strokeWidth={2.25} aria-hidden />
        <ProfileTap pubkey={agent} nested><ProfilePic pubkey={agent} size={22} /></ProfileTap>
        <span className="notif__toast-text">{more > 0 ? `${who} messaged you, and ${more} more…` : `${who} messaged you`}</span>
      </button>
    )
  }
  if (!latest || unread === 0) return null
  const who = profileLabel(profile, nip19.npubEncode(latest.from))
  // A tag on its own goes straight to its line in chat; with more unread,
  // the list, as for anything else.
  const tag = latest.what === 'mention' && latest.on.type === 'chat' ? latest.on.id : null
  const open = (): void => {
    if (tag && unread === 1) { useNotifications.getState().markSeen(); useChat.getState().reveal(tag); return }
    useNotifications.getState().setOpen(true)
  }
  const text = unread > 1
    ? (tag ? `${who} tagged you, and ${unread - 1} more…` : `and ${unread - 1} more…`)
    : tag ? `${who} tagged you: ${mentionWords(latest)}` : `${who} ${verbOf(latest)}`
  return (
    <button className="hyperbar notif__toast" onClick={open} aria-label={`${unread} unread notifications. Tap to see.`}>
      <span className="notif__toast-glyph" aria-hidden="true">{glyphOf(latest)}</span>
      <ProfileTap pubkey={latest.from} nested><ProfilePic pubkey={latest.from} size={22} /></ProfileTap>
      <span className="notif__toast-text">{text}</span>
    </button>
  )
}

/** Fetch one event by id from your relays and inbox. */
async function fetchById(id: string): Promise<{ kind: number; pubkey: string; tags: string[][] } | null> {
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
    walkChain(i === chain.length - 1 ? null : i)
    useSocialUi.getState().openAction(chain[i])
    return null
  }
  const raw = cs.events.find((e) => e.id === id) ?? (await fetchById(id))
  const action = raw ? parseAction(raw as Parameters<typeof parseAction>[0]) : null
  // An event found but not readable on its own: a game's move, or an action
  // this client does not recognize, needs its chain around it to say what it is.
  if (!action && raw) return 'That action is not one this client can show on its own: it is a move inside a game, or an action this client does not recognize. Open the chain it is on in the chain explorer to see it in place.'
  if (!action) return 'That move could not be found on any relay.'
  useSocialUi.getState().openAction(action)
  return null
}

/**
 * Open what an item notification names: the row this device hid it as
 * (lib/notifications itemToView), else the shard as published (arkinox,
 * 2026-11-14: "when I click View Shard, it just says the shard is published
 * so there's nothing to see... that's horrible ux").
 */
async function openItem(on: { id: string | null; lookupId?: string; address?: string; kind?: number }): Promise<string | null> {
  const got = await itemToView(() => useShards.getState().mine, on, fetchById)
  if ('why' in got) return got.why
  if ('published' in got) return openPublishedShard(got.published, useCyberspace.getState().identity.pubkey)
  goToDeployment(got.row)
  return null
}

/** How far up a thread VIEW climbs to find the item a reply hangs under. */
const THREAD_CLIMB = 8

/**
 * The item a comment in a bag's thread answers: the top comment's parent,
 * found by climbing reply to parent. Null when a step cannot be read: the
 * bag is all VIEW then knows.
 */
async function itemOfThread(comment: { kind: number; tags: string[][] }): Promise<string | null> {
  let c: { kind: number; tags: string[][] } | null = comment
  for (let i = 0; c && i < THREAD_CLIMB; i += 1) {
    const parent = c.tags.find((t) => t[0] === 'e')?.[1]
    if (!parent) return null
    if (Number(c.tags.find((t) => t[0] === 'k')?.[1]) !== COMMENT_KIND) return parent
    c = await fetchById(parent)
  }
  return null
}

/**
 * Go to what a notification is about, landing on its comment or its
 * reactions (store/useModalFocus). Resolves to a reason when it cannot.
 */
export async function view(n: Notification): Promise<string | null> {
  // A tag in local chat: the dock, scrolled to that line, with no modal over it.
  if (n.on.type === 'chat') { leaveModals(); useChat.getState().reveal(n.on.id); return null }
  useModalFocus.getState().land(landingOf(n))
  const why = await openTarget(n)
  if (why) useModalFocus.getState().done()
  return why
}

async function openTarget(n: Notification): Promise<string | null> {
  if (n.on.type === 'action') return openMove(n.on.id)
  if (n.on.type === 'item') return openItem(n.on)
  // A reply or a reaction to your comment: open where that comment was made.
  const comment = await fetchById(n.on.id)
  if (!comment || comment.kind !== COMMENT_KIND) return 'That comment could not be found on any relay.'
  const rootKind = Number(comment.tags.find((t) => t[0] === 'K')?.[1])
  if (rootKind === 3333) {
    const root = comment.tags.find((t) => t[0] === 'E')?.[1]
    return root ? openMove(root) : 'That comment names no move.'
  }
  if (rootKind === SNO_KIND) {
    const address = comment.tags.find((t) => t[0] === 'A')?.[1]
    const id = comment.tags.find((t) => t[0] === 'E')?.[1] ?? null
    return openPublishedShard({ ...(address ? { address } : {}), id }, useCyberspace.getState().identity.pubkey)
  }
  const bag = comment.tags.find((t) => t[0] === 'A')?.[1]
  return openItem({ id: await itemOfThread(comment), lookupId: bag?.split(':')[2] })
}

function Row({ n, words }: { n: Notification; words?: string }): JSX.Element {
  const profile = useProfile(n.from)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const who = profileLabel(profile, nip19.npubEncode(n.from))
  // Not seen before: the dot and the brighter row, until the modal closes (useNotifications setOpen).
  const fresh = useNotifications((s) => n.createdAt > s.lastSeen)
  // Your rows load per identity after the list may already be up (#559): their arrival rewords a shard you hid.
  const me = useCyberspace((s) => s.identity.pubkey)
  useShards((s) => publishedShardOnly(n.on, s.mine, me))
  // What VIEW opens stacks over this modal, which stays open under it (modalStack).
  const go = async (): Promise<void> => {
    setBusy(true); setProblem(null)
    const why = await view(n)
    setBusy(false)
    if (why) setProblem(why)
  }
  const text = n.what === 'comment' ? (n.sealed ? words ?? null : n.content) : null
  return (
    <li className={`notif__row${fresh ? ' is-new' : ''}`}>
      <span className="notif__glyph" aria-hidden="true">{glyphOf(n)}</span>
      <div className="notif__main">
        <div className="notif__head">
          <ProfileTap pubkey={n.from}><ProfilePic pubkey={n.from} size={22} /></ProfileTap>
          <ProfileTap pubkey={n.from} className="notif__who">{who}</ProfileTap>
          {fresh && <span className="notif__dot notif__dot--row" role="img" aria-label="New" />}
          <span className="notif__when" title={formatStamp(n.createdAt)}>{formatAgo(n.createdAt)}</span>
        </div>
        <p className="notif__verb">{verbOf(n)}</p>
        {n.what === 'mention' && <p className="notif__words">{mentionWords(n, 280)}</p>}
        {n.what === 'comment' && (
          text
            ? <p className="notif__words">{text}</p>
            : <p className="notif__words notif__words--sealed">{n.sealed ? 'Sealed to the place it answers: go there to read it.' : PLACEHOLDER}</p>
        )}
        <button className="secret__act notif__view" disabled={busy} onClick={() => void go()}>
          {busy ? 'OPENING…' : 'VIEW'}
        </button>
        {problem && <p className="comments__error">{problem}</p>}
      </div>
    </li>
  )
}

/** Every notification, newest first; older ones load as the end of the list comes into view. */
export function NotificationsModal(): JSX.Element | null {
  const open = useNotifications((s) => s.open)
  const all = useNotifications((s) => s.items)
  const muted = useMutes((s) => s.muted)
  const items = useMemo(() => (muted.pubkeys.size + muted.items.size === 0 ? all : all.filter((n) => !mutedNote(n, muted))), [all, muted])
  const opened = useNotifications((s) => s.opened)
  const loading = useNotifications((s) => s.loading)
  const done = useNotifications((s) => s.done)
  const trouble = useNotifications((s) => s.trouble)
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
  // Escape closes it as a tap outside does (arkinox, 2026-10-01); what VIEW
  // opens stacks over it, and Escape closes that first (modalStack).
  useModalStack(open, () => useNotifications.getState().setOpen(false))

  if (!open) return null
  const close = (): void => useNotifications.getState().setOpen(false)
  return (
    <Stacked>
    <div className="modal modal--top" role="dialog" aria-modal="true" aria-label="Notifications" onPointerDown={close}>
      <div className="modal__card secret notif" onPointerDown={(e) => e.stopPropagation()}>
        <div className="secret__head">
          <span className="secret__label notif__title">NOTIFICATIONS</span>
          <button className="secret__close" onClick={close} aria-label="Close">✕</button>
        </div>
        <div className="notif__scroll" ref={list}>
          {trouble && !loading && <RelayTrouble trouble={trouble} onRetry={() => void useNotifications.getState().poll()} />}
          {!loading && <BackupTrouble onRetry={() => void useNotifications.getState().poll()} />}
          {items.length === 0 && !loading && !trouble && <p className="comments__empty">Nothing yet. Reactions and comments on your moves and hidden items, and chat lines that tag you, land here.</p>}
          <ul className="notif__list">
            {items.map((n) => <Row key={n.id} n={n} words={opened[n.id]} />)}
          </ul>
          <div ref={end} className="notif__end">{loading ? 'LOADING…' : done && items.length > 0 ? 'THAT IS EVERYTHING' : ''}</div>
        </div>
      </div>
    </div>
    </Stacked>
  )
}
