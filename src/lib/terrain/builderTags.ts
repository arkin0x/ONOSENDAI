/**
 * builderTags.ts - the two builder tags of DECK-0009 §4, written onto the
 * movement actions the player puts a signature on anyway.
 *
 * `["builder", "<hex>"]` names this device's builder key, so its block
 * layers count as the player's; `["builder-retire", "<hex>"]` (with "all"
 * for a key that may have been copied) retires one. The chain rules never
 * read either (§4.5), as they never read the no-broadcast tag
 * (lib/noBroadcast.ts), and like that tag these are added in one place, the
 * store's signEvent (store/useCyberspace.ts), so no path can forget them and
 * none asks for a signature of its own (owner, 2026-11-24).
 *
 * Which tags are owed, and for whom, is the builder key's business
 * (lib/terrain/builderKey.ts registers it here); this module imports nothing,
 * so the store and the signers can use it freely.
 *
 * Never on a template already mined (a NIP-13 `nonce` tag: a new tag would
 * void the work), and never on anything but a movement action (kind 3333).
 *
 * WALK's steps are proved before they are signed, and the next step's proof
 * binds this one's id (store/useCyberspace.ts lanes). Their tags are fixed
 * when the step is proved (`fixTags`), and signEvent leaves a fixed template
 * alone, so a key made between proving and signing never changes the id the
 * next step was proved against.
 */

/** The movement action's kind. A literal, so this module imports nothing. */
const ACTION_KIND = 3333

export const BUILDER_TAG = 'builder'
export const BUILDER_RETIRE_TAG = 'builder-retire'
/** The single-letter tag beside every `builder-retire`, naming the same key, so relays index retirements (§4.3). */
export const RETIRE_INDEX_TAG = 'R'

type Owed = (signer: string) => string[][]
let owed: Owed = () => []

/** Set what says which builder tags a movement action by `signer` carries now (lib/terrain/builderKey.ts). Returns what puts the one before back. */
export function owedBuilderTagsFrom(source: Owed): () => void {
  const before = owed
  owed = source
  return () => { if (owed === source) owed = before }
}

/** The builder tags owed on `signer`'s next movement action. A source that throws owes nothing. */
export function owedBuilderTags(signer: string): string[][] {
  try { return owed(signer) } catch { return [] }
}

const fixed = new WeakSet<object>()

/** Mark a template whose id is already relied on: signEvent adds nothing to it. */
export function fixTags<T extends object>(template: T): T {
  fixed.add(template)
  return template
}

/** Whether a template's tags are fixed (fixTags). */
export function tagsFixed(template: object): boolean {
  return fixed.has(template)
}

const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i])

/**
 * The template with every owed builder tag it does not already carry, or the
 * same object when none is owed or it already carries them all (so a caller
 * comparing objects sees no change).
 */
export function withBuilderTags<T extends { kind: number; tags: string[][] }>(template: T, signer: string): T {
  if (template.kind !== ACTION_KIND || template.tags.some((t) => t[0] === 'nonce')) return template
  const add = owedBuilderTags(signer).filter((t) => !template.tags.some((have) => same(have, t)))
  return add.length === 0 ? template : { ...template, tags: [...template.tags, ...add] }
}

type Heard = (ev: { id: string; pubkey: string; kind: number; tags: string[][] }) => void
const listeners = new Set<Heard>()

/** Be told of every movement action signed on this page (to learn which ones carry a builder tag). */
export function onActionSigned(fn: Heard): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Called by signEvent with every movement action it signed. */
export function noteActionSigned(ev: { id: string; pubkey: string; kind: number; tags: string[][] }): void {
  if (ev.kind !== ACTION_KIND) return
  for (const fn of listeners) { try { fn(ev) } catch { /* one listener never stops a signature */ } }
}
