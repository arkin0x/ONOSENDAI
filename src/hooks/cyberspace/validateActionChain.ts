import { actionChainIsValid } from "./actionChainIsValid"
import { ActionsState } from "./actionReducerTypes"

export const validateActionChain = (actions: ActionsState): boolean => {
  if (actions.length === 0) return false

  const mutateActions = [...actions]

  // DEBUG FIXME: remove this
  // console.log("Validate Action Chain: ", actions.length, " actions: ", actions)
  return true

  // validate action chain
  return actionChainIsValid(mutateActions)
}