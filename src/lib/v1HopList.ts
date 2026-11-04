/**
 * v1HopList.ts: the version 1 hops exempt under spec 5.13, as cyberspace-core
 * embeds them, in a chunk of their own, loaded only by what needs them
 * (lib/v1HopListGuard says why). A core bump carries a new list.
 *
 * The path goes around core's `exports`, which offers only its main entry, and
 * so around the guard, which answers core's own import of this file.
 */

let load: Promise<ReadonlySet<string>> | null = null

/** The real list. A failed load is not kept, so the next call asks again. */
export function loadV1HopList(): Promise<ReadonlySet<string>> {
  load ??= import('../../node_modules/cyberspace-core/dist/grandfathered_v1_hops.js')
    .then((m) => m.GRANDFATHERED_V1_HOPS)
    .catch((err: unknown) => {
      load = null
      throw err
    })
  return load
}
