/**
 * release.ts — when the chain is allowed to leave this device, and what the
 * chain panel calls an action that has or has not left it.
 *
 * Two rules in one file because they are the same fact from two sides: the
 * gate decides what reaches the relay, the tag reports what reached it.
 *
 * ## The gate
 *
 * LIVE and LOCAL is one switch for the whole identity (`useCyberspace.live`,
 * the two-word switch under COMMIT in TouchControls). It used to be that
 * flipping it to LIVE drained everything signed so far onto the relay at
 * once, which made the flip itself an act of publication: someone who had
 * been moving privately for an hour and wanted only the NEXT hop seen had no
 * way to ask for that, because the flip took the hour with it before they
 * could act.
 *
 * So the flip publishes nothing. The gate opens only when a new action is
 * appended to the chain while LIVE, and then the whole backlog goes with it.
 * All of it, because a hop whose ancestors are missing is a hop no reader
 * ever reaches: reading a chain means walking forward from the spawn
 * following each event's `previousId`, and stopping at the first link that
 * does not resolve. One action published alone reveals nothing and proves
 * nothing, so there is no such thing as publishing only the newest one.
 *
 * Going back to LOCAL shuts the gate again, so the next visit to LIVE starts
 * from the same quiet place.
 *
 * The gate is state, not a setting, and is never persisted. A reload with
 * LIVE remembered starts shut for the same reason the flip does: nothing
 * leaves this device except as the consequence of an action taken here, on
 * purpose, while LIVE.
 *
 * What the gate deliberately does not touch is order. The publisher still
 * drains oldest first, so every prefix the relay holds is itself a valid
 * chain; the gate only decides whether it drains at all.
 */

import type { PublishStatus } from '../store/useCyberspace'

/** The three things about the store the gate rule reads. */
export interface ChainFacts {
  /** The identity's publishing switch. */
  live: boolean
  /** Id of the chain head, which is the newest action. */
  headId: string
  /**
   * The head is already on the relay. True for a head this device adopted
   * from the relay (`adoptChain`), which is somebody else's copy of our own
   * chain arriving, not an action taken here, and must not open the gate.
   */
  headSent: boolean
}

/** Read the facts out of the store, or out of anything shaped like it. */
export function chainFacts(s: {
  live: boolean
  prevEventId: string
  published: Record<string, PublishStatus>
}): ChainFacts {
  return { live: s.live, headId: s.prevEventId, headSent: s.published[s.prevEventId] === 'ok' }
}

/**
 * The gate after one store change. Pure: `open` in, the next `open` out.
 *
 * | Change | Gate |
 * |---|---|
 * | anything, ending LOCAL | shut |
 * | LOCAL to LIVE | shut: the flip publishes nothing |
 * | LIVE, a new head this device signed | open: and the backlog goes with it |
 * | LIVE, a head adopted from the relay | unchanged: not an action of ours |
 * | anything else | unchanged |
 *
 * A respawn while LIVE counts as a new action, because that is what it is:
 * §3.2 signs a new spawn event, it becomes the head, and it is queued rather
 * than sent. The chain it retired is gone from the store, so the drain that
 * follows carries the new spawn and nothing else.
 */
export function gateAfter(open: boolean, prev: ChainFacts, next: ChainFacts): boolean {
  if (!next.live) return false
  if (!prev.live) return false
  if (next.headId !== prev.headId && !next.headSent) return true
  return open
}

/**
 * ## The tag
 *
 * What one action's row in the chain panel says about itself. LIVE is the
 * only one of the four that means the relay has it; the other three are all
 * still here, told apart so that a refusal does not read as a choice.
 */
export type PublishTag = 'live' | 'local' | 'sending' | 'failed'

/** Per event id, from `useCyberspace.published`. An id with no entry is local. */
export function publishTag(status: PublishStatus | undefined): PublishTag {
  switch (status) {
    case 'ok': return 'live'
    case 'sending': return 'sending'
    case 'failed': return 'failed'
    // 'queued', and an id the map has never heard of: signed, still here.
    default: return 'local'
  }
}

export const PUBLISH_TAG_LABEL: Record<PublishTag, string> = {
  live: 'LIVE',
  local: 'LOCAL',
  sending: 'SENDING',
  failed: 'FAILED',
}

export const PUBLISH_TAG_TITLE: Record<PublishTag, string> = {
  live: 'On the relay: anyone reading this chain can see this action.',
  local: 'Signed and held on this device. It goes out with the whole chain the next time you act while LIVE.',
  sending: 'On its way to the relay now.',
  failed: 'The relay would not take it. The publisher keeps retrying while LIVE.',
}
