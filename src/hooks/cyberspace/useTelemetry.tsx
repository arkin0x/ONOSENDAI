import { useCallback, useEffect, useReducer, useState } from "react"
import { useCyberspaceStateReconciler } from "./useCyberspaceStateReconciler"
import { CyberspaceStateReconciler } from "./useCyberspaceStateReconciler"
import { DecimalVector3 } from "../../libraries/DecimalVector3"
import { Quaternion } from "three"

export type CyberspaceTelemetry = {
  telemetryState: CyberspaceStateReconciler,
  stateIndex: number,
  stateLength: number,
  changeIndex: (index: number) => void,
}

// telemetry will save every state change and enable us to replay them.
export const useTelemetry = (): CyberspaceTelemetry => {

  const [inDefaultState, setInDefaultState] = useState(true) // the default state has an empty fake CyberspaceStateReconciler state. This is to prevent errors on load because the state would be undefined. When the first state is saved, this will be set to false and the default state will be deleted and replaced with the real first state.

  const defaultState: CyberspaceStateReconciler = {
    actions: [],
    position: new DecimalVector3(0, 0, 0),
    velocity: new DecimalVector3(0, 0, 0),
    rotation: new Quaternion(0, 0, 0, 1),
    simulationHeight: 0,
    actionChainState: { status: 'invalid' }
  }

  const [telemetryStates, saveTelemetryState] = useReducer((state: CyberspaceStateReconciler[], action: CyberspaceStateReconciler) => {
    if (inDefaultState) {
      setInDefaultState(false)
      return [action]
    } else {
      // const lastState = state[state.length-1]
      // const lastStateAction = lastState.actions[lastState.actions.length-1]
      // const lastAction = action.actions[action.actions.length-1]
      // if (lastStateAction === lastAction) { // don't save states where there are no new actions.
      //   return state
      // }
      return [...state, action]
    }
  },[defaultState])

  const [telemetryStateIndex, setTelemetryStateIndex] = useState(0)

  const { actions, position, velocity, rotation, simulationHeight, actionChainState } = useCyberspaceStateReconciler()

  /**
   * When any variable from useCyberspaceStateReconciler changes, save the state.
   */
  useEffect(() => {
    if (!actions.length) return // don't save telemetry states where we have no actions, or when we don't have a new action.
    saveTelemetryState({actions, position, velocity, rotation, simulationHeight, actionChainState})
  }, [actions, actionChainState])

  const changeIndex = useCallback((index: number) => {
    if (index < 0) {
      setTelemetryStateIndex(0)
    } else if (index > telemetryStates.length - 1) {
      setTelemetryStateIndex(telemetryStates.length - 1)
    } else {
      setTelemetryStateIndex(index)
    }
  }, [telemetryStates, setTelemetryStateIndex])

  return { 
    telemetryState: telemetryStates[telemetryStateIndex],
    stateIndex: telemetryStateIndex,
    stateLength: telemetryStates.length,
    changeIndex,
  }

}