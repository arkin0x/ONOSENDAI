/**
 * noBroadcast.ts: the no-broadcast tag (spec §8.13), written and read.
 *
 * `["no-broadcast"]` is the publisher's request that an event not be shown to
 * an audience: Cyberspace TV, a feed, a highlight reel, a board. The chain
 * rules never read it, so a tagged action is a real action on a real chain;
 * only a broadcaster treats it differently (owner, 2026-11-14: "a general
 * purpose, do not broadcast tag. And on a Sendai CyberSpace TV will simply
 * not broadcast any event carrying that tag").
 *
 * Writing: while the first-arrival tutorial runs for the identity on screen
 * (store/useTutorial.ts registers that test here), every public Cyberspace
 * event this client signs carries the tag, added in one place, the store's
 * signEvent (withNoBroadcast), so no action can forget it. Once the run ends,
 * pauses or closes, new events go out without it; an event already signed
 * keeps the tag it was signed with. Never on:
 * - a sealed entry (33335): spec §7.6 forbids any other tag there, and the
 *   kind is not in TAGGED_KINDS;
 * - an item inside a bag (3330, 1, 3340, 3341, 1063, a seed 3351), nor an
 *   object a bag names by reference (a 33331 carrying `encrypted`): none is
 *   shown in the clear, and the tag would stay on it for every finder to read
 *   (spec §8.13);
 * - anything that is not a public Cyberspace event: a profile, a relay or
 *   mute list, a DM's seal or wrap, an auth, a deletion, a chat envelope;
 * - an avatar (11333): it is replaceable, one per identity, and TV draws
 *   every avatar it shows from the newest one, so a tagged avatar would
 *   either be shown anyway or leave the player with no look on TV until they
 *   chose one again (review of this change). An avatar from another client
 *   that carries the tag is still never a "new avatar" moment on TV;
 * - a template already mined (a `nonce` tag, NIP-13): adding a tag would
 *   change its id and void the work.
 *
 * Reading: noBroadcast(e) is what Cyberspace TV skips (lib/tv/tape.ts, the
 * scan's bags in store/useTv.ts) and what its numbers leave out
 * (lib/countingRules.ts). Every other reader treats a tagged event as any
 * other.
 */

/** The tag's name, its first element (spec §8.13). */
export const NO_BROADCAST = 'no-broadcast'

/**
 * The kinds the tutorial's events are tagged on: a movement action (3333), a
 * bag (33330), a public object (33331), an item listing (33340), a comment
 * (1111) and a reaction (7). Literals, so this module imports nothing (the
 * store, the signers and the counting rules all use it).
 */
export const TAGGED_KINDS: ReadonlySet<number> = new Set([3333, 33330, 33331, 33340, 1111, 7])

/** Whether an event carries the no-broadcast tag: any tag whose first element is `no-broadcast` (spec §8.13). */
export function noBroadcast(e: { tags: string[][] }): boolean {
  return e.tags.some((t) => t[0] === NO_BROADCAST)
}

/**
 * What says whether an event signed now by `signer` (a pubkey; the identity
 * on screen when not given) is to carry the tag: the tutorial running for
 * that player.
 */
type Hold = (signer?: string) => boolean
let holding: Hold = () => false

/** Set what says whether events are to carry the tag now (store/useTutorial.ts). Returns what puts the one before back. */
export function holdBroadcastWhile(test: Hold): () => void {
  const before = holding
  holding = test
  return () => { if (holding === test) holding = before }
}

/** Whether an event `signer` signs now carries the tag. A test that throws holds nothing. */
export function holdingBroadcast(signer?: string): boolean {
  try { return holding(signer) } catch { return false }
}

/** Whether a template is one the tag goes on (TAGGED_KINDS, not a hidden object, not already mined). */
export function taggable(template: { kind: number; tags: string[][] }): boolean {
  if (!TAGGED_KINDS.has(template.kind)) return false
  if (template.kind === 33331 && template.tags.some((t) => t[0] === 'encrypted')) return false
  return !template.tags.some((t) => t[0] === 'nonce')
}

/** The template with the no-broadcast tag when `signer`'s events are held from broadcast now and it is taggable; else as it is. */
export function withNoBroadcast<T extends { kind: number; tags: string[][] }>(template: T, signer?: string): T {
  if (!taggable(template) || noBroadcast(template) || !holdingBroadcast(signer)) return template
  return { ...template, tags: [...template.tags, [NO_BROADCAST]] }
}
