import { ActionsState, ActionsReducer } from "./actionReducerTypes"

export const actionsReducer = (state: ActionsState, action: ActionsReducer) => {
  // add new action to state
  const newState = [...state, action.payload] as ActionsState
  return newState
}
