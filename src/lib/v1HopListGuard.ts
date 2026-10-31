/**
 * v1HopListGuard.ts: what cyberspace-core's own import of its version 1 hop
 * list resolves to in this app (the v1HopListGuard plugin in vite.config.ts).
 *
 * The real list (spec 5.13) is 2658 event ids, about 97 KB gzipped. Core's
 * verifyHopLevel1 reads `claim.grandfathered ?? GRANDFATHERED_V1_HOPS`, so
 * importing that function would put the whole list in the first load, even for
 * a caller that always passes its own set. Here the default is this guard, and
 * the real list comes from lib/v1HopList when something needs it.
 *
 * Reading the guard throws. A verifier that forgot its `grandfathered` would
 * otherwise see every old hop as unlisted, which breaks the chain from there,
 * and it would look like a verdict. Every call to verifyHopLevel1 here passes
 * `grandfathered`: the real list for hops others signed, an empty set for a hop
 * this client just signed, which is never on the list.
 */

function refuse(): never {
  throw new Error('verifyHopLevel1 needs an explicit `grandfathered` here: the embedded list is not loaded (lib/v1HopList)')
}

export const GRANDFATHERED_V1_HOPS: ReadonlySet<string> = new Proxy(new Set<string>(), { get: refuse })

/** The real commit is on the real list (lib/v1HopList). */
export const GRANDFATHERED_V1_HOPS_COMMIT = ''
