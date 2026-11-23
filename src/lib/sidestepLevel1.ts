/**
 * sidestepLevel1.ts - the claim a reader builds from a signed sidestep, and
 * cyberspace-core's Level 1 check of it (spec 8.7.2), with no worker in
 * sight: the verify worker runs this, and the page runs it when no worker
 * can start (lib/sidestepCheck.ts says why and what it costs).
 */

import { coordToXyz, hexToCoord, verifySidestepLevel1, type Plane, type SidestepClaim } from 'cyberspace-core'
import type { NostrEvent } from './events'
import type { Position } from './space'

const HEX64 = /^[0-9a-f]{64}$/

/**
 * The claim a reader would build from this signed sidestep, with its c, C
 * and previous taken from this client. A list of what is malformed when no
 * claim can be built.
 */
export function sidestepClaimOf(event: NostrEvent, fromHex: string, to: Position, plane: Plane, prevEventId: string): SidestepClaim | string[] {
  if (!HEX64.test(fromHex)) return ['c']
  const tagOf = (name: string): string | undefined => event.tags.find((t) => t[0] === name)?.[1]
  const mr = (tagOf('mr') ?? '').split(':')
  const mp = (tagOf('mp') ?? '').split(':')
  const heights = ['hx', 'hy', 'hz'].map((n) => Number(tagOf(n)))
  const bad: string[] = []
  if (mr.length !== 3) bad.push('mr')
  if (mp.length !== 3) bad.push('mp')
  heights.forEach((h, i) => { if (!Number.isInteger(h)) bad.push(['hx', 'hy', 'hz'][i]) })
  if (bad.length > 0) return bad
  const from = coordToXyz(hexToCoord(fromHex))
  return {
    from: { x: from.x, y: from.y, z: from.z },
    to: { x: to.x, y: to.y, z: to.z },
    plane,
    previousEventIdHex: prevEventId,
    merkleRoots: mr as [string, string, string],
    openings: mp as [string, string, string],
    nonce: tagOf('mn') ?? null,
    eventId: event.id,
    lcaHeights: heights as [number, number, number],
    proofHash: tagOf('proof') ?? '',
  }
}

/** verifySidestepLevel1, with a throw named as a failure rather than thrown. */
export function checkSidestepClaim(claim: SidestepClaim): string[] {
  try {
    return verifySidestepLevel1(claim)
  } catch (err) {
    return [`check: ${err instanceof Error ? err.message : String(err)}`]
  }
}
