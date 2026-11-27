/**
 * place.ts - leaving a card of a blueprint you hold (DECK-0010 §7.3, §7.5):
 * where you stand, like leaving a message, or in a chest.
 *
 * - 'here' lines the card up on the hide bar (useShards startDeployBlueprint):
 *   BUILD mode comes up with its ghost at the build cursor, and PLACE seals it
 *   in your bag for that region as a kind 3343 item signed by you.
 * - 'chest' lines up a new chest on the hide bar with the card already inside
 *   (useShards startPlaceChest): PLACE CHEST fixes where it stands and the
 *   chest modal opens with the card listed, ready for a lock and more.
 *
 * Either way the card carries the creator's record unchanged, so the creator
 * keeps the credit and you are "left here by". A card you found is left again
 * the same way (the re-hide the owner approved, 2026-11-27). Taking one never
 * removes it, so leaving one is never a move.
 *
 * Until blueprints go live (format.ts BLUEPRINT_RELAY_READY) a card, and a
 * chest that holds one, is placed LOCAL only: on this device, even while the
 * app is LIVE (useShards cardsStayLocal), and the hide bar says so.
 *
 * Returns why it could not start, in plain words, or null.
 */

import { GAME_NO_DEPLOY } from './gameCard'
import { leaveModals } from '../../hud/modalStack'
import { copyLinedUp, useShards } from '../../store/useShards'
import type { BlueprintCard } from './blueprintDb'
import { readRecord } from './format'

/** Why a card cannot be left: its record does not read. */
export const CARD_UNREADABLE = 'This blueprint could not be read, so it cannot be left anywhere.'
/** Why it waits: a hide is still going out. */
export const PLACE_BUSY = 'Something is still going out. Try again when it lands.'
/** Why it waits: something else is lined up on the hide bar. */
export const PLACE_LINED_UP = 'Finish or cancel what is lined up first.'

/** Start placing a card: 'here' leaves it where you stand, 'chest' puts it in a new chest. */
export function startPlaceBlueprint(card: BlueprintCard, where: 'here' | 'chest'): string | null {
  // The game's own blueprint is never placed: it is no one's record, and everyone has it.
  if (card.source === 'game') return GAME_NO_DEPLOY
  if (!readRecord(card.record)) return CARD_UNREADABLE
  let shards = useShards.getState()
  if (shards.deployStatus === 'working') return PLACE_BUSY
  // The last placement lined up again is no work of yours to lose: it stands down, as CANCEL would.
  if (copyLinedUp(shards)) {
    shards.cancelDeploy()
    shards = useShards.getState()
  }
  if (shards.pending) return PLACE_LINED_UP
  if (where === 'here') shards.startDeployBlueprint(card)
  else shards.startPlaceChest({ name: '', lock: null, requires: '', contents: [{ kind: 'blueprint', card }] })
  // Lined up at the build cursor: the modals go, so the scene it is placed in is in view.
  leaveModals()
  return null
}
