/**
 * trust.ts - whose objects are yours to rely on: your own, and those of the
 * authors you follow (your kind 3 contact list, lib/contacts.ts followsOf).
 *
 * WALK's walls (store/walkWalls.ts) and the scene's meshes (scene/meshBudget.ts)
 * both spend a budget by it: a reserved share for what you trust, which no
 * stranger can spend, and the rest shared by strangers under a per-shard
 * ceiling (arkinox, 2026-10-25: "ok A sounds good"). A shard is trusted only
 * when BOTH whoever put it there (the bag's signer, or a chest's sealer) and
 * the author of the object it draws are trusted (trustedPlacement): a LIVE LINK
 * in your own bag to a stranger's object is the stranger's, and a stranger's
 * bag of live links to your own public object is the stranger's too, or anyone
 * could spend your share with copies of your work.
 */

import { you } from './carried'
import { followsOf } from './contacts'

/** The authors you follow, as last read; empty until it is. */
let follows: ReadonlySet<string> = new Set()
/** Whose follows those are, so a new identity reads its own. */
let followsOfWho: string | null = null
const listeners = new Set<() => void>()
/** Bumped on every change, for a component's snapshot. */
let version = 0

/** Whether `author` is you or someone you follow. No author at all is a model made here, by you. */
export function trustedAuthor(author: string | null | undefined): boolean {
  const me = you()
  const a = author ?? me
  return a !== null && (a === me || follows.has(a))
}

/**
 * Whether a shard is trusted: whoever put it where it is (`container`, the
 * bag's signer or a chest's sealer) and the author of the object it draws
 * (`object`) are both trusted. Either missing is a shard made here, by you.
 */
export function trustedPlacement(container: string | null | undefined, object: string | null | undefined): boolean {
  return trustedAuthor(container) && trustedAuthor(object ?? container)
}

/** Say whom you follow (readFollows does; tests call it directly), and tell everyone who listens. */
export function setFollows(list: Iterable<string>): void {
  follows = new Set(list)
  version++
  for (const l of listeners) l()
}

/** Read your follows once per identity; a read that failed is asked again the next time. */
export function readFollows(): void {
  const me = you()
  if (!me || me === followsOfWho) return
  // Another identity: whom the last one followed is not whom this one does.
  if (followsOfWho !== null && follows.size) setFollows([])
  followsOfWho = me
  void followsOf(me).then((list) => { if (followsOfWho === me) setFollows(list) }, () => { if (followsOfWho === me) followsOfWho = null })
}

/** Hear of a change of follows; the return stops it. */
export function onFollows(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** A number that changes whenever the follows do (useSyncExternalStore). */
export function followsVersion(): number {
  return version
}

/** Forget them: tests, and a change of identity. */
export function resetFollows(): void {
  follows = new Set()
  followsOfWho = null
  version++
}
