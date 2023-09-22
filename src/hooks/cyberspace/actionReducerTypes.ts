import { Action } from "../../types/Cyberspace"

export type ActionsState = Action[]
export type ActionsReducer = {
  type: 'add'
  payload: Action
}
