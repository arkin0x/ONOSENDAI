/**
 * dm.ts: private messages between an operator and their agent, as NIP-17
 * gift-wrapped direct messages.
 *
 * Rulings of arkinox, 2026-10-10 (the operator and agent DMs contract): all
 * operator and agent communication is private NIP-17 DMs, nothing public;
 * STRATEGY is a sealed DM carrying the marker tag ["agent", "strategy"],
 * and the agent keeps the newest one as standing orders. The wire format is
 * NIP-17 exactly, because a parallel builder writes the agent's side
 * (cyberspace-mcp) against the same contract:
 *
 * | Layer | Kind | Signed by | Tags | Content | created_at |
 * |---|---|---|---|---|---|
 * | rumor | 14 | nobody (id only) | p recipient, plus the STRATEGY marker | the text | now |
 * | seal | 13 | the sender | none | NIP-44 of the rumor, sender to recipient | up to 2 days back |
 * | wrap | 1059 | a fresh key per wrap | p recipient only | NIP-44 of the seal, fresh key to recipient | up to 2 days back |
 *
 * The sender wraps the same rumor to their own pubkey too, so their history
 * survives on every device. On receipt a wrap is unwrapped, the seal's
 * signature checked, and the rumor kept only when its pubkey is the seal's:
 * otherwise anyone could seal a rumor claiming to be someone else.
 *
 * Pure: the keys come in as signers (anything with a pubkey, signEvent and
 * NIP-44), so no socket and no store is touched here. The caller hands in
 * the fresh key that signs each wrap (signers.ts localSigner over
 * generateSecretKey), which keeps every raw-key signature in signers.ts
 * (clientTagGuard.test.ts). Neither the seal nor the wrap carries a client
 * tag (client.ts), and this file checks that what the signer returned holds
 * to that, since an extension or a bunker signs on its own terms.
 */

import { getEventHash, verifyEvent } from 'nostr-tools/pure'
import type { EventTemplate, NostrEvent } from './events'

export const DM_KIND = 14
/**
 * A private reaction (arkinox, 2026-10-12: "when I send my agent a message,
 * can we have him ALWAYS react to the message with an 👀 emoji immediately
 * when he sees it?"). A kind 7 rumor, as NIP-25 shapes it (an e tag naming the
 * rumor id it reacts to, a p tag naming that rumor's author), sealed and
 * gift-wrapped exactly as a kind 14 is, to the other side's 10050 relays with
 * a self-copy. Nothing about it is public.
 */
export const REACTION_KIND = 7
export const SEAL_KIND = 13
export const WRAP_KIND = 1059

/** The marker that makes a message the agent's standing orders (contract ruling 3). */
export const STRATEGY_TAG: readonly [string, string] = ['agent', 'strategy']

/**
 * The marker of a KEEP GOING order (arkinox, 2026-10-11: "if XOR runs out of
 * time budget, I want to be able to tell him keep going"). The agent's server
 * reads it, not its model: a marked DM from the operator renews the agent's
 * session budget once, so neither the model nor text read in cyberspace can
 * grant compute by saying "keep going".
 */
export const CONTINUE_TAG: readonly [string, string] = ['agent', 'continue']

/** How far into the past a seal's or a wrap's created_at may be moved: two days, as NIP-59 suggests. */
export const MAX_BACKDATE_S = 2 * 24 * 60 * 60

/** What a sender needs: its pubkey, a signature, and NIP-44 encrypt. */
export interface DmSender {
  pubkey: string
  signEvent: (template: EventTemplate) => Promise<NostrEvent>
  nip44Encrypt: (recipientPubkey: string, plaintext: string) => Promise<string>
}

/** What a recipient needs: its pubkey and NIP-44 decrypt. */
export interface DmReader {
  pubkey: string
  nip44Decrypt: (senderPubkey: string, payload: string) => Promise<string>
}

/** An unsigned kind 14: the message itself, with its id and no signature. */
export interface Rumor {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
}

const HEX = /^[0-9a-f]{64}$/

/** Seconds since the epoch. */
function nowS(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * A created_at up to MAX_BACKDATE_S before `now`, so a relay that sees the
 * wrap cannot tie it to the moment the message was written. `random` is in
 * [0, 1), Math.random unless a test hands in its own; the timing it hides is
 * not a secret worth a cryptographic source, and NIP-59 asks for none.
 */
export function randomPast(now: number = nowS(), random: () => number = Math.random): number {
  return now - Math.floor(random() * MAX_BACKDATE_S)
}

/** Whether a rumor carries the STRATEGY marker. */
export function isStrategy(rumor: Pick<Rumor, 'tags'>): boolean {
  return rumor.tags.some((t) => t[0] === STRATEGY_TAG[0] && t[1] === STRATEGY_TAG[1])
}

/** Whether a rumor carries the KEEP GOING marker. */
export function isContinue(rumor: Pick<Rumor, 'tags'>): boolean {
  return rumor.tags.some((t) => t[0] === CONTINUE_TAG[0] && t[1] === CONTINUE_TAG[1])
}

/** The pubkeys a rumor's p tags name. */
export function recipientsOf(rumor: Pick<Rumor, 'tags'>): string[] {
  return rumor.tags.filter((t) => t[0] === 'p' && HEX.test(t[1] ?? '')).map((t) => t[1])
}

/** The kind 14 from `sender` to `recipient`: one p tag, plus the marker for a STRATEGY. */
export function createRumor(sender: string, recipient: string, text: string, opts: { strategy?: boolean; keepGoing?: boolean; now?: number } = {}): Rumor {
  const tags: string[][] = [['p', recipient]]
  if (opts.strategy) tags.push([...STRATEGY_TAG])
  if (opts.keepGoing) tags.push([...CONTINUE_TAG])
  const unsigned = { pubkey: sender, created_at: opts.now ?? nowS(), kind: DM_KIND, tags, content: text }
  return { ...unsigned, id: getEventHash(unsigned) }
}

/**
 * The kind 7 from `sender` reacting with `content` to the rumor `target`,
 * written by `recipient`: an e tag and a p tag, as the agent's side sends it.
 */
export function createReactionRumor(sender: string, recipient: string, target: string, content: string, opts: { now?: number } = {}): Rumor {
  const unsigned = { pubkey: sender, created_at: opts.now ?? nowS(), kind: REACTION_KIND, tags: [['e', target], ['p', recipient]], content }
  return { ...unsigned, id: getEventHash(unsigned) }
}

/** The rumor sealed by its sender to `recipient`: kind 13, no tags, signed. */
export async function sealRumor(rumor: Rumor, sender: DmSender, recipient: string, random?: () => number): Promise<NostrEvent> {
  if (rumor.pubkey !== sender.pubkey) throw new Error('A rumor can only be sealed by its own author.')
  const content = await sender.nip44Encrypt(recipient, JSON.stringify(rumor))
  const seal = await sender.signEvent({ kind: SEAL_KIND, created_at: randomPast(undefined, random), tags: [], content })
  // An extension or a bunker signs what it likes: a seal that came back with
  // a tag (a client tag added by the signer) or under another key is not sent.
  if (seal.kind !== SEAL_KIND || seal.tags.length !== 0 || seal.pubkey !== sender.pubkey) {
    throw new Error('The signer changed the sealed message (a tag or another key), so it was not sent.')
  }
  return seal
}

/** The seal wrapped to `recipient` by a key used for this one wrap: kind 1059, only the p tag. */
export async function wrapSeal(seal: NostrEvent, recipient: string, fresh: DmSender, random?: () => number): Promise<NostrEvent> {
  const content = await fresh.nip44Encrypt(recipient, JSON.stringify(seal))
  const wrap = await fresh.signEvent({ kind: WRAP_KIND, created_at: randomPast(undefined, random), tags: [['p', recipient]], content })
  if (wrap.kind !== WRAP_KIND || wrap.tags.length !== 1 || wrap.tags[0].length !== 2 || wrap.tags[0][0] !== 'p' || wrap.tags[0][1] !== recipient) {
    throw new Error('The gift wrap came back with more than its p tag, so it was not sent.')
  }
  return wrap
}

/** A message ready to go: the rumor, its wrap for the recipient, and the self-copy. */
export interface Wrapped {
  rumor: Rumor
  toRecipient: NostrEvent
  toSelf: NostrEvent
}

/**
 * One message from `sender` to `recipient`, wrapped twice: once to the
 * recipient and once to the sender (the self-copy), each with its own seal
 * and its own fresh wrapping key. `freshKey` makes one new signer per call.
 */
export async function wrapMessage(
  sender: DmSender,
  recipient: string,
  text: string,
  freshKey: () => DmSender,
  opts: { strategy?: boolean; keepGoing?: boolean; now?: number; random?: () => number } = {},
): Promise<Wrapped> {
  if (!HEX.test(recipient)) throw new Error('The recipient is not a public key.')
  if (!text.trim()) throw new Error('An empty message is not sent.')
  const rumor = createRumor(sender.pubkey, recipient, text, opts)
  const toRecipient = await wrapSeal(await sealRumor(rumor, sender, recipient, opts.random), recipient, freshKey(), opts.random)
  const toSelf = await wrapSeal(await sealRumor(rumor, sender, sender.pubkey, opts.random), sender.pubkey, freshKey(), opts.random)
  return { rumor, toRecipient, toSelf }
}

function parse(json: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(json) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch { return null }
}

function isTags(v: unknown): v is string[][] {
  return Array.isArray(v) && v.every((t) => Array.isArray(t) && t.every((x) => typeof x === 'string'))
}

/**
 * Open a gift wrap addressed to `me`, keeping a rumor of one of `kinds`. Null
 * for anything that is not sound NIP-17: not a wrap, a seal whose signature
 * fails, a rumor whose pubkey is not the seal's, a rumor whose id is not its
 * own hash, a rumor of another kind, or a payload that does not decrypt.
 * Such a wrap is dropped, never shown.
 */
export async function unwrapRumor(wrap: NostrEvent, me: DmReader, kinds: readonly number[] = [DM_KIND, REACTION_KIND]): Promise<Rumor | null> {
  if (wrap.kind !== WRAP_KIND) return null
  let sealJson: string
  try { sealJson = await me.nip44Decrypt(wrap.pubkey, wrap.content) } catch { return null }
  const seal = parse(sealJson)
  if (!seal || seal.kind !== SEAL_KIND || typeof seal.pubkey !== 'string' || typeof seal.content !== 'string') return null
  // The seal's signature is what proves who wrote the message.
  if (!verifyEvent(seal as unknown as Parameters<typeof verifyEvent>[0])) return null
  let rumorJson: string
  try { rumorJson = await me.nip44Decrypt(seal.pubkey, seal.content) } catch { return null }
  const r = parse(rumorJson)
  if (!r || typeof r.kind !== 'number' || !kinds.includes(r.kind) || typeof r.content !== 'string' || typeof r.created_at !== 'number' || !isTags(r.tags)) return null
  if (r.pubkey !== seal.pubkey) return null
  const unsigned = { pubkey: r.pubkey, created_at: r.created_at, kind: r.kind, tags: r.tags, content: r.content }
  const id = getEventHash(unsigned)
  if (r.id !== undefined && r.id !== id) return null
  return { ...unsigned, id }
}

/** Open a gift wrap addressed to `me`, keeping only a kind 14 message (unwrapRumor). */
export function unwrapMessage(wrap: NostrEvent, me: DmReader): Promise<Rumor | null> {
  return unwrapRumor(wrap, me, [DM_KIND])
}

/** A message in one conversation, as the conversation shows it. */
export interface DmMessage {
  id: string
  /** Who wrote it. */
  from: string
  text: string
  /** The rumor's own created_at: the real time it was written. */
  at: number
  strategy: boolean
  /** A KEEP GOING order (CONTINUE_TAG). */
  keepGoing?: boolean
}

/**
 * The other side of a rumor in my conversations: the agent it is with. A
 * rumor I wrote to one recipient is with that recipient; a rumor written to
 * me alone is with its author. A group message (more than one other person)
 * belongs to no one-to-one conversation, and null says so.
 */
export function counterpartOf(rumor: Pick<Rumor, 'pubkey' | 'tags'>, me: string): string | null {
  const to = [...new Set(recipientsOf(rumor))]
  if (rumor.pubkey === me) {
    const others = to.filter((p) => p !== me)
    return others.length === 1 ? others[0] : null
  }
  return to.length === 1 && to[0] === me ? rumor.pubkey : null
}

/** A rumor as a conversation message. */
export function toMessage(rumor: Rumor): DmMessage {
  return { id: rumor.id, from: rumor.pubkey, text: rumor.content, at: rumor.created_at, strategy: isStrategy(rumor), keepGoing: isContinue(rumor) }
}

/** A reaction in one conversation: who reacted, with what, to which message, and when. */
export interface DmReaction {
  /** The reaction rumor's own id. */
  id: string
  from: string
  /** The rumor id of the message reacted to. */
  target: string
  /** The emoji, as sent (NIP-25: "+" is a like, "" counts as one too). */
  content: string
  at: number
}

/**
 * A kind 7 rumor as a reaction, or null when it names no message. NIP-25
 * reads the last e tag as the target.
 */
export function toReaction(rumor: Rumor): DmReaction | null {
  if (rumor.kind !== REACTION_KIND) return null
  const es = rumor.tags.filter((t) => t[0] === 'e' && HEX.test(t[1] ?? ''))
  const target = es[es.length - 1]?.[1]
  return target ? { id: rumor.id, from: rumor.pubkey, target, content: rumor.content, at: rumor.created_at } : null
}

/** Reactions oldest first, each id once (the self-copy shares the rumor id). */
export function mergeReactions(have: readonly DmReaction[], more: readonly DmReaction[]): DmReaction[] {
  const byId = new Map<string, DmReaction>()
  for (const r of [...have, ...more]) if (!byId.has(r.id)) byId.set(r.id, r)
  return [...byId.values()].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
}

/**
 * The reactions to show under each message of one conversation, by the
 * message's rumor id: only those from its two parties (`me` and `agent`), and
 * only on messages that are loaded. A reaction to a message not yet loaded is
 * kept and shows once the message is (arkinox, 2026-10-12).
 */
export function reactionsByMessage(reactions: readonly DmReaction[], messages: readonly DmMessage[], me: string, agent: string): Record<string, DmReaction[]> {
  const ids = new Set(messages.map((m) => m.id))
  const out: Record<string, DmReaction[]> = {}
  for (const r of reactions) {
    if ((r.from !== me && r.from !== agent) || !ids.has(r.target)) continue
    ;(out[r.target] ??= []).push(r)
  }
  return out
}

/** Messages oldest first, each id once (the self-copy and an optimistic add share the rumor id). */
export function mergeMessages(have: readonly DmMessage[], more: readonly DmMessage[]): DmMessage[] {
  const byId = new Map<string, DmMessage>()
  for (const m of [...have, ...more]) if (!byId.has(m.id)) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
}

/** The STRATEGY in force: the newest marked message the operator wrote, or null. */
export function currentStrategy(messages: readonly DmMessage[], operator: string): DmMessage | null {
  let best: DmMessage | null = null
  for (const m of messages) {
    if (!m.strategy || m.from !== operator) continue
    // A same-second tie goes to the lowest id, as NIP-01 breaks ties.
    if (!best || m.at > best.at || (m.at === best.at && m.id < best.id)) best = m
  }
  return best
}
