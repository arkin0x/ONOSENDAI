import { actionChainIsValid } from "./actionChainIsValid"
import { ActionsState } from "./actionReducerTypes"

export const validateActionChain = (actions: ActionsState): boolean => {
  if (actions.length === 0) return false

  const mutateActions = [...actions]

  // validate action chain
  return actionChainIsValid(mutateActions)
}