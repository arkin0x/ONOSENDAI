/**
 * social.ts: reactions (NIP-25, kind 7) and public comments (NIP-22, kind
 * 1111) on the things people do in cyberspace, in the clear.
 *
 * Two things can be reacted to. An ACTION is one signed movement event
 * (kind 3333) on somebody's chain; it is public already, so reactions and
 * comments on it are public too, and the chain's author is `p`-tagged so
 * their client tells them (arkinox, 2026-09-28: "neither reactions nor
 * comments need to be encrypted by location because we want the recipient to
 * see them"). A hidden ITEM (a shard or message sealed in a bag) takes
 * reactions the same way. Its comments stay sealed to the place (comments.ts);
 * a reaction carries no words, only the item's id, which nobody who has not
 * opened the bag can place.
 *
 * Every event here names what it answers by `e` (id, relay hint, author) and
 * `k` (the answered event's kind), and tags the author by `p`, which is what
 * every NIP-25 and NIP-22 client uses to notify.
 */

import type { EventTemplate, NostrEvent } from './events'
import { CLIENT_TAG, COMMENT_KIND, MAX_COMMENT_LENGTH } from './comments'

export const REACTION_KIND = 7
/** The movement event every chain action is (spec §8.3). */
export const ACTION_KIND = 3333

/**
 * The reactions offered with one tap. `+` is NIP-25's like, drawn as a heart;
 * the rest are the ones people already use on ONOSENDAI posts.
 */
export const REACTIONS = ['+', '🤙', '🔥', '😎', '🩵', '👍'] as const

/** What a reaction or comment answers: its event id, author and kind. */
export interface SocialTarget {
  id: string
  pubkey: string
  kind: number
}

/** A reaction's content as it should be drawn: `+` is a like, `-` a dislike (NIP-25). */
export function reactionGlyph(content: string): string {
  if (content === '+' || content === '') return '❤️'
  if (content === '-') return '👎'
  return content
}

/** The kind 7 template for one reaction to one event. `extraP` also tags, say, the author of a shard hidden by reference. */
export function reactionTemplate(target: SocialTarget, content: string, createdAt: number, extraP: string[] = []): EventTemplate {
  const tagged = [target.pubkey, ...extraP.filter((p) => p !== target.pubkey)]
  return {
    kind: REACTION_KIND,
    created_at: createdAt,
    content,
    tags: [
      ['e', target.id, '', target.pubkey],
      ...tagged.map((p) => ['p', p]),
      ['k', String(target.kind)],
      [...CLIENT_TAG],
    ],
  }
}

/**
 * A plaintext NIP-22 comment on an action: the root scope is the action by
 * `E`/`K`/`P`, the parent is the action for a top-level comment or the
 * comment answered for a reply.
 */
export function actionCommentTemplate(action: SocialTarget, text: string, createdAt: number, parent?: SocialTarget): EventTemplate {
  const body = text.trim().slice(0, MAX_COMMENT_LENGTH)
  if (!body) throw new Error('a comment needs some text')
  const p = parent ?? action
  const tagged = [...new Set([p.pubkey, action.pubkey])]
  return {
    kind: COMMENT_KIND,
    created_at: createdAt,
    content: body,
    tags: [
      ['E', action.id, '', action.pubkey],
      ['K', String(action.kind)],
      ['P', action.pubkey],
      ['e', p.id, '', p.pubkey],
      ['k', String(p.kind)],
      ...tagged.map((pk) => ['p', pk]),
      [...CLIENT_TAG],
    ],
  }
}

export interface Reaction {
  id: string
  pubkey: string
  createdAt: number
  /** The content as written: `+`, `-`, an emoji, or a `:shortcode:`. */
  content: string
  /** The image for a NIP-30 custom emoji, when the content is its shortcode. */
  image?: string
  /** The event reacted to: the last `e` tag, per NIP-25. */
  targetId: string
  /** The reacted event's kind, from `k`, when given. */
  targetKind: number | null
}

/** A kind 7 as a reaction, or null when it is not one. */
export function parseReaction(ev: NostrEvent): Reaction | null {
  if (ev.kind !== REACTION_KIND) return null
  const es = ev.tags.filter((t) => t[0] === 'e' && t[1])
  const target = es[es.length - 1]?.[1]
  if (!target) return null
  const content = ev.content.trim() || '+'
  const k = Number(ev.tags.find((t) => t[0] === 'k')?.[1])
  const code = /^:([\w-]+):$/.exec(content)?.[1]
  const image = code ? ev.tags.find((t) => t[0] === 'emoji' && t[1] === code)?.[2] : undefined
  return { id: ev.id, pubkey: ev.pubkey, createdAt: ev.created_at, content, image, targetId: target, targetKind: Number.isFinite(k) ? k : null }
}

/** One row of the reaction list: an emoji and who reacted with it. */
export interface ReactionGroup {
  content: string
  image?: string
  /** Who, oldest first; a pubkey appears once per emoji. */
  pubkeys: string[]
  /** Each reactor's reaction id, for taking your own back. */
  ids: Map<string, string>
}

/**
 * Reactions to one event, one row per emoji, the most used first and ties by
 * which came first. Deleted reactions are left out; a person reacting twice
 * with the same emoji counts once.
 */
export function groupReactions(events: NostrEvent[], targetId: string, deleted: ReadonlySet<string> = new Set()): ReactionGroup[] {
  const rows = new Map<string, ReactionGroup & { first: number }>()
  const sorted = events.map(parseReaction).filter((r): r is Reaction => !!r && r.targetId === targetId && !deleted.has(r.id))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  for (const r of sorted) {
    const row: ReactionGroup & { first: number } = rows.get(r.content) ?? { content: r.content, image: r.image, pubkeys: [], ids: new Map<string, string>(), first: r.createdAt }
    if (!row.ids.has(r.pubkey)) { row.pubkeys.push(r.pubkey); row.ids.set(r.pubkey, r.id) }
    rows.set(r.content, row)
  }
  return [...rows.values()].sort((a, b) => b.pubkeys.length - a.pubkeys.length || a.first - b.first)
    .map(({ first: _first, ...g }) => g)
}

/** Ids a kind 5 deletes, when its author is the one who wrote them (NIP-09: only an author can delete). */
export function deletedBy(events: NostrEvent[], authorOf: ReadonlyMap<string, string>): Set<string> {
  const out = new Set<string>()
  for (const ev of events) {
    if (ev.kind !== 5) continue
    for (const t of ev.tags) if (t[0] === 'e' && t[1] && authorOf.get(t[1]) === ev.pubkey) out.add(t[1])
  }
  return out
}

/** The kind 5 that takes back one of your reactions. */
export function unreactTemplate(reactionId: string, createdAt: number): EventTemplate {
  return { kind: 5, created_at: createdAt, content: '', tags: [['e', reactionId], ['k', String(REACTION_KIND)]] }
}
