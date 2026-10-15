/**
 * useChat.ts — talk to whoever is standing where you are.
 *
 * A chat line is a kind 23333 event, signed by you, that never travels bare:
 * it is sealed inside a kind 23330 ephemeral envelope keyed to the region you
 * said it in, the cube of side 2^SCAN_MAX_HEIGHT around you. The relay keeps
 * nothing and hands the envelope to whoever is subscribed at that moment;
 * whoever is standing in that cube has its key from their own passive scan
 * and reads the words. Everyone else sees ciphertext, and only while it is
 * in flight.
 *
 * What is kept on this device is the words, who said them, when, and which
 * region they were said in: enough to read the room again after a reload.
 * The signed events are not kept; they are said and gone, as the kind says.
 */

import { create } from 'zustand'
import { chatInnerTemplate, chatInners, chatRumor, bagTemplate, CHAT_BAG_KIND, MAX_CHAT_LENGTH } from '../lib/hidden'
import { hexToBytes, type NostrEvent } from '../lib/events'
import { publishMany, relaySet } from '../lib/relay'
import { chime } from '../lib/chime'
import { useCyberspace } from './useCyberspace'
import { useSecrets } from './useSecrets'
import { SCAN_MAX_HEIGHT } from './useShards'
import { encodeMentions, freshMentions, prependMention, pTagged, type Mention } from '../lib/mentions'
import { mentionNotification } from '../lib/notifications'
import { useNotifications } from './useNotifications'

export interface ChatLine {
  /** The inner event's id: the line's identity, what stops a repeat. */
  id: string
  from: string
  text: string
  /** Seconds since the epoch, as the sender signed it. */
  at: number
  /** The region it was said in: the envelope's `d`. */
  region: string
  /** The cube's height; how far the words carried. */
  height: number
  mine: boolean
  /**
   * Who the line's p tags name: the people it is addressed to (arkinox,
   * 2026-10-11). Absent on lines kept before mentions existed.
   */
  mentions?: string[]
}

const STORAGE_KEY = 'onosendai:chat'
const MUTE_KEY = 'onosendai:chat:muted'
/** Lines kept on this device, oldest dropped first. */
export const CHAT_MAX = 500

function loadLines(): ChatLine[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as unknown
    return Array.isArray(list) ? (list as ChatLine[]).filter((l) => l && typeof l.id === 'string' && typeof l.text === 'string') : []
  } catch {
    return []
  }
}

function saveLines(lines: ChatLine[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lines.slice(-CHAT_MAX))) } catch { /* private mode */ }
}

function loadMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false }
}

export type SendStatus = 'idle' | 'signing' | 'sending' | 'error'

interface ChatState {
  lines: ChatLine[]
  /** Whether the dock is unfolded. Folded by default; a message unfolds it. */
  open: boolean
  /** Lines that arrived while the dock was folded; the chip's dot while above 0. */
  unread: number
  /**
   * Of those, the lines that tagged you (arkinox, 2026-10-13): while above 0
   * the chip carries an @ badge with the count instead of the plain dot.
   */
  mentionsUnread: number
  /** A line to bring into view when the dock is next drawn open (a tag's notification). */
  revealId: string | null
  /** Where the caret goes when the dock next takes focus: after a tag CHAT put at the start. */
  caretOnOpen: number | null
  muted: boolean
  draft: string
  /** People picked from the @ list for this draft; resolved to NIP-27 on send. */
  picked: Mention[]
  /** Set by the `/` key: unfold and put the caret in the line. */
  focusOnOpen: boolean
  sendStatus: SendStatus
  sendError: string | null
  setOpen: (open: boolean) => void
  toggleMuted: () => void
  setDraft: (draft: string) => void
  /** Remember someone picked from the @ list, so send can turn their @Name into nostr:npub. */
  pick: (mention: Mention) => void
  /** CHAT on someone's avatar card: unfold, `@them ` at the start of the draft, the caret after it. */
  startTo: (mention: Mention) => void
  /** Unfold and bring one line into view: a tag's notification, tapped. */
  reveal: (lineId: string) => void
  /** Say the draft into the region you are standing in. */
  send: () => Promise<void>
  /** An ephemeral envelope from the relay: open it with what you have. */
  receive: (outer: NostrEvent) => Promise<void>
  /** Forget every line on this device. The relay never had them. */
  clear: () => void
}

/**
 * The key a line is sealed with: the widest cube the passive scan reaches,
 * so that anyone whose scan reaches it (which is everyone standing in it)
 * can open it. A smaller cube would carry less far for no gain.
 */
export function sendKey(): { lookupId: string; keyHex: string; height: number } | null {
  const current = useSecrets.getState().current
  let best: { lookupId: string; keyHex: string; height: number } | null = null
  for (const [lookupId, k] of Object.entries(current)) {
    if (k.height > SCAN_MAX_HEIGHT) continue
    if (!best || k.height > best.height) best = { lookupId, keyHex: k.keyHex, height: k.height }
  }
  return best
}

/** Newest last, no repeats: one line per inner event id. */
export function mergeLines(have: ChatLine[], add: ChatLine[]): ChatLine[] {
  const seen = new Set(have.map((l) => l.id))
  const fresh = add.filter((l) => !seen.has(l.id))
  if (fresh.length === 0) return have
  return [...have, ...fresh].sort((a, b) => a.at - b.at).slice(-CHAT_MAX)
}

/**
 * True while an arriving line must not unfold the dock: on a phone with the
 * controls out, unfolding would put them away (arkinox, 2026-10-07). Set by
 * linkChatAndPad in usePad.ts, which owns the controls; false otherwise.
 */
let holdFolded: () => boolean = () => false
export function setHoldFolded(hold: () => boolean): void { holdFolded = hold }

/** The least time between two buzzes for tags from the same person. */
export const MENTION_BUZZ_MS = 5_000
const lastBuzz = new Map<string, number>()

/** One short vibration for tags from these senders, each at most once per MENTION_BUZZ_MS, only while the tab is on screen. */
export function buzzFor(senders: readonly string[], now = Date.now()): boolean {
  const due = senders.filter((s) => now - (lastBuzz.get(s) ?? -Infinity) >= MENTION_BUZZ_MS)
  if (due.length === 0) return false
  for (const s of due) lastBuzz.set(s, now)
  try {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(60)
  } catch { /* no vibration here */ }
  return true
}

export const useChat = create<ChatState>((set, get) => ({
  lines: loadLines(),
  open: false,
  unread: 0,
  mentionsUnread: 0,
  revealId: null,
  caretOnOpen: null,
  muted: loadMuted(),
  draft: '',
  picked: [],
  focusOnOpen: false,
  sendStatus: 'idle',
  sendError: null,

  setOpen: (open) => set(open ? { open, unread: 0, mentionsUnread: 0 } : { open }),

  toggleMuted: () => {
    const muted = !get().muted
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0') } catch { /* private mode */ }
    set({ muted })
  },

  // An emptied draft forgets its picks, so a later "@Al" typed by hand is not taken for one.
  setDraft: (draft) => set({ draft: draft.slice(0, MAX_CHAT_LENGTH), picked: draft.trim() === '' ? [] : get().picked }),

  pick: (mention) => set({ picked: [...get().picked.filter((m) => m.pubkey !== mention.pubkey), mention] }),

  startTo: (mention) => {
    const next = prependMention(get().draft, get().picked, mention, MAX_CHAT_LENGTH)
    set({ draft: next.draft, picked: next.picked, open: true, unread: 0, mentionsUnread: 0, focusOnOpen: true, caretOnOpen: next.caret })
  },

  reveal: (lineId) => set({ open: true, unread: 0, mentionsUnread: 0, revealId: lineId }),

  send: async () => {
    const text = get().draft.trim()
    if (!text || get().sendStatus === 'signing' || get().sendStatus === 'sending') return
    const key = sendKey()
    if (!key) {
      set({ sendStatus: 'error', sendError: 'No region key yet: the scan of where you stand has not finished.' })
      return
    }
    // Each @Name picked from the list goes out as nostr:npub (NIP-27), and the
    // people it names as p tags (arkinox, 2026-10-11).
    const wire = encodeMentions(text, get().picked)
    if (wire.text.length > MAX_CHAT_LENGTH) {
      set({ sendStatus: 'error', sendError: 'Too long once the mentions are written out. Shorten the line.' })
      return
    }
    const cyber = useCyberspace.getState()
    const now = Math.floor(Date.now() / 1000)
    try {
      set({ sendStatus: 'signing', sendError: null })
      // The line is a rumor, never signed: only the envelope is (chatRumor).
      const inner = chatRumor(chatInnerTemplate(wire.text, cyber.position, cyber.plane, now, key.lookupId, wire.pubkeys), cyber.identity.pubkey)
      set({ sendStatus: 'sending' })
      const outer = await cyber.signEvent(await bagTemplate([inner], hexToBytes(key.keyHex), key.lookupId, key.height, now, CHAT_BAG_KIND))
      const result = await publishMany(relaySet(), outer)
      if (!result.ok) {
        set({ sendStatus: 'error', sendError: `Not sent: ${result.reason}` })
        return
      }
      // Your own line goes straight in: an ephemeral event is not echoed back
      // by every relay, and a line you said should not depend on that.
      const line: ChatLine = { id: inner.id, from: inner.pubkey, text: inner.content, at: inner.created_at, region: key.lookupId, height: key.height, mine: true, mentions: pTagged(inner.tags) }
      const lines = mergeLines(get().lines, [line])
      saveLines(lines)
      set({ lines, draft: '', picked: [], sendStatus: 'idle', sendError: null })
    } catch (err) {
      set({ sendStatus: 'error', sendError: err instanceof Error ? err.message : String(err) })
    }
  },

  receive: async (outer) => {
    const region = outer.tags.find((t) => t[0] === 'd')?.[1]
    if (!region) return
    // Your own cube, or one of the 26 around it: a line said across the wall.
    const secrets = useSecrets.getState()
    const key = secrets.current[region] ?? secrets.neighbors[region]
    if (!key) return
    const inners = await chatInners(outer, hexToBytes(key.keyHex))
    if (inners.length === 0) return
    const me = useCyberspace.getState().identity.pubkey
    const add = inners.map((e) => ({ id: e.id, from: e.pubkey, text: e.content.slice(0, MAX_CHAT_LENGTH), at: e.created_at, region, height: key.height, mine: e.pubkey === me, mentions: pTagged(e.tags) }))
    const before = get().lines
    const lines = mergeLines(before, add)
    if (lines === before) return
    saveLines(lines)
    const theirs = lines.length - before.length
    const fromOthers = add.some((l) => !l.mine)
    // Lines that tag you and have just arrived (not a replayed room).
    const tagged = freshMentions(add, new Set(before.map((l) => l.id)), me, Math.floor(Date.now() / 1000))
    // Someone spoke: the dock unfolds and, unless it is muted, chimes. Not
    // over the controls on a phone (holdFolded): there it stays folded, the
    // line counts as unread, and the chip carries the dot until it is opened.
    const unfold = fromOthers && (get().open || !holdFolded())
    const seen = get().open || unfold
    set({
      lines,
      open: unfold ? true : get().open,
      unread: seen ? 0 : get().unread + theirs,
      mentionsUnread: seen ? 0 : get().mentionsUnread + tagged.length,
    })
    if (fromOthers && !get().muted) chime()
    // A tag is more than a line (arkinox, 2026-10-13): it goes into
    // NOTIFICATIONS, which raises the toast, and the phone buzzes once per
    // sender every few seconds. It never unfolds the dock on its own.
    for (const l of tagged) useNotifications.getState().addMention(me, mentionNotification(l))
    buzzFor(tagged.map((l) => l.from))
  },

  clear: () => {
    saveLines([])
    set({ lines: [], unread: 0, mentionsUnread: 0, revealId: null })
  },
}))

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __chat: typeof useChat }).__chat = useChat
}
