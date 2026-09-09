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
import { chatInnerTemplate, chatInners, bagTemplate, CHAT_BAG_KIND, MAX_CHAT_LENGTH } from '../lib/hidden'
import { hexToBytes, type NostrEvent } from '../lib/events'
import { publishMany, relaySet } from '../lib/relay'
import { chime } from '../lib/chime'
import { useCyberspace } from './useCyberspace'
import { useSecrets } from './useSecrets'
import { SCAN_MAX_HEIGHT } from './useShards'

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
  /** Lines that arrived while the dock was folded. */
  unread: number
  muted: boolean
  draft: string
  /** Set by the `/` key: unfold and put the caret in the line. */
  focusOnOpen: boolean
  sendStatus: SendStatus
  sendError: string | null
  setOpen: (open: boolean) => void
  toggleMuted: () => void
  setDraft: (draft: string) => void
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

export const useChat = create<ChatState>((set, get) => ({
  lines: loadLines(),
  open: false,
  unread: 0,
  muted: loadMuted(),
  draft: '',
  focusOnOpen: false,
  sendStatus: 'idle',
  sendError: null,

  setOpen: (open) => set({ open, unread: open ? 0 : get().unread }),

  toggleMuted: () => {
    const muted = !get().muted
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0') } catch { /* private mode */ }
    set({ muted })
  },

  setDraft: (draft) => set({ draft: draft.slice(0, MAX_CHAT_LENGTH) }),

  send: async () => {
    const text = get().draft.trim()
    if (!text || get().sendStatus === 'signing' || get().sendStatus === 'sending') return
    const key = sendKey()
    if (!key) {
      set({ sendStatus: 'error', sendError: 'No region key yet: the scan of where you stand has not finished.' })
      return
    }
    const cyber = useCyberspace.getState()
    const now = Math.floor(Date.now() / 1000)
    try {
      set({ sendStatus: 'signing', sendError: null })
      const inner = await cyber.signEvent(chatInnerTemplate(text, cyber.position, cyber.plane, now))
      set({ sendStatus: 'sending' })
      const outer = await cyber.signEvent(await bagTemplate([inner], hexToBytes(key.keyHex), key.lookupId, key.height, now, CHAT_BAG_KIND))
      const result = await publishMany(relaySet(), outer)
      if (!result.ok) {
        set({ sendStatus: 'error', sendError: `Not sent: ${result.reason}` })
        return
      }
      // Your own line goes straight in: an ephemeral event is not echoed back
      // by every relay, and a line you said should not depend on that.
      const line: ChatLine = { id: inner.id, from: inner.pubkey, text: inner.content, at: inner.created_at, region: key.lookupId, height: key.height, mine: true }
      const lines = mergeLines(get().lines, [line])
      saveLines(lines)
      set({ lines, draft: '', sendStatus: 'idle', sendError: null })
    } catch (err) {
      set({ sendStatus: 'error', sendError: err instanceof Error ? err.message : String(err) })
    }
  },

  receive: async (outer) => {
    const region = outer.tags.find((t) => t[0] === 'd')?.[1]
    if (!region) return
    const key = useSecrets.getState().current[region]
    if (!key) return
    const inners = await chatInners(outer, hexToBytes(key.keyHex))
    if (inners.length === 0) return
    const me = useCyberspace.getState().identity.pubkey
    const add = inners.map((e) => ({ id: e.id, from: e.pubkey, text: e.content.slice(0, MAX_CHAT_LENGTH), at: e.created_at, region, height: key.height, mine: e.pubkey === me }))
    const before = get().lines
    const lines = mergeLines(before, add)
    if (lines === before) return
    saveLines(lines)
    const theirs = lines.length - before.length
    const fromOthers = add.some((l) => !l.mine)
    // Someone spoke: the dock unfolds and, unless it is muted, chimes.
    set({ lines, open: fromOthers ? true : get().open, unread: get().open || fromOthers ? 0 : get().unread + theirs })
    if (fromOthers && !get().muted) chime()
  },

  clear: () => {
    saveLines([])
    set({ lines: [], unread: 0 })
  },
}))

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __chat: typeof useChat }).__chat = useChat
}
