import { actionChainIsValid } from "./actionChainIsValid"
import { ActionsState } from "./actionReducerTypes"

export const validateActionChain = (actions: ActionsState): boolean => {
  if (actions.length === 0) return false

  const mutateActions = [...actions]

  // sort actions by created_at+ms tag from oldest to newest
  mutateActions.sort((a, b) => {
    const aMs = a.tags.find(tag => tag[0] === 'ms')
    const bMs = b.tags.find(tag => tag[0] === 'ms')
    const aTs = a.created_at * 1000 + (aMs ? parseInt(aMs[1]) : 0)
    const bTs = b.created_at * 1000 + (bMs ? parseInt(bMs[1]) : 0)
    return aTs - bTs
  })

  // validate action chain
  return actionChainIsValid(mutateActions)
}