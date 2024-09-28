import { extractCyberspaceActionState, getMillisecondsTimestampFromAction, getCyberspacePlaneFromAction, simulateNextEvent, CyberspaceAction } from "../../libraries/Cyberspace"
import { getTag, getTagMark } from "../../libraries/NostrUtils"

export const actionChainIsValid = (actions: CyberspaceAction[]): boolean => {
  const tests = []

  // wrap the whole thing in a try; any errors will invalidate the chain, although this could lead to false invalidations if the code is wrong but the chain is right... 🤔 #TODO
  // things that are most likely to invalidate the chain are missing tags

  const GENESIS_ACTION = actions[0]
  const LAST_INDEX = actions.length - 1

  try {
    // TEST 1 - HASH CHAIN
    // check the e tags for valid references. Every subsequent action must reference the previous one and reference the genesis action
    const testHashChainState = [...actions]
    tests.push(testHashChainState.reverse().every((action, index) => {
      // we reversed the array because we want to start with the most recent action and follow it back to the genesis action
      // the references work in reverse:
      // [previous action]    [current action]
      // [id             ] <- [e:previous_id ]
      // so reverisng the array gives us:
      // [current action]    [previous action]
      // [e:previous_id ] -> [id             ]
      
      // genesis action gets a pass - no previous action to reference
      if (index === LAST_INDEX) {
        return true
      }

      // check if the next action (previous chronologically) is referenced in the current action
      const nextAction = testHashChainState[index + 1]
      if (action.tags.find(getTagMark('e',nextAction.id))) {
        return true
      }
      console.warn('invalid hash chain', action.id, nextAction.id)
      return false
    }))

    // TEST 2 - NO FUTURE ACTIONS
    // most recent action must be now or in the past, but not in the future 
    const testLatestActionTimestampState = actions[LAST_INDEX]
    const latest_ts = getMillisecondsTimestampFromAction(testLatestActionTimestampState)
    const current_ts = Date.now()
    tests.push(latest_ts <= current_ts)

    // DEBUG
    if (latest_ts > current_ts) {
      console.warn('latest action is in the future', latest_ts, current_ts)
    }



    // TEST 3 - VALID SIGNATURES
    // check signature on each action
    // TODO

    // the following validations only apply if we have more than 1 acton in the chain
    if (actions.length > 1) {

      // TEST 4 - SEQUENTIAL TIMESTAMPS
      // each timestamp must increment sequentially
      const testTimestampSequenceState = [...actions]
      const timestampSequenceIsValid = testTimestampSequenceState.reduce<false | number>((timestamp, action) => {
        // get the timestamp from the action
        const latest_ts = getMillisecondsTimestampFromAction(action)
        if (timestamp === false) {
          return false
        }
        if (timestamp < latest_ts) {
          return latest_ts
        } else {
          return false
        }
      }, 0)
      tests.push(!!timestampSequenceIsValid)

      if (!timestampSequenceIsValid) {
        console.warn('invalid timestamp sequence', timestampSequenceIsValid)
      }

      // TEST 5 - VALID PLANES
      // check the plane and make sure it is valid
      // TODO: implement portals to switch planes; currently stuck on the starting plane
      const testPlaneState = [...actions]
      const startPlane = getCyberspacePlaneFromAction(GENESIS_ACTION)
      const planeIsValid = testPlaneState.reduce<false | 'd-space' | 'i-space'>((plane, action) => {
        // get the plane from the action
        const currPlane = getCyberspacePlaneFromAction(action)
        if (plane === currPlane) {
          return plane
        } else {
          return false
        }
      }, startPlane)
      tests.push(!!planeIsValid)

      if (!planeIsValid) {
        console.warn('invalid plane', planeIsValid)
      }

      // TEST 6 - Next Action === Simulated Action
      const testSimulatedActionState = [...actions]

      // for each action in the chain, simulate the next action and compare it to the next action in the chain. Omit the last action as there is nothing to compare it to.
      const resultSimulatedAction = testSimulatedActionState.every((action, index) => {
        // if this is the last action, we're done
        if (index === LAST_INDEX) {
          return true
        }
        // if this is not the last action, simulate the next action and compare it to the next action in the chain.
        const nextAction = testSimulatedActionState[index + 1]
        const nextActionState = extractCyberspaceActionState(nextAction)
        const simulatedNextAction = simulateNextEvent(action, nextActionState.time)

        // compare the simulated action to the next action in the chain
        // compare 'Cd' tag values
        // FIXME: old events might not have Cd tags.
        const decimal1 = simulatedNextAction.tags.find(getTag('Cd'))!.slice(1)
        const decimal2 = nextAction.tags.find(getTag('Cd'))!.slice(1)
        const decimalEqual = decimal1.every((v, i) => decimal2[i] === v)
        // compare 'velocity' tag values
        const velocity1 = simulatedNextAction.tags.find(getTag('velocity'))!.slice(1)
        const velocity2 = nextAction.tags.find(getTag('velocity'))!.slice(1)
        const velocityEqual = velocity1.every((v, i) => velocity2[i] === v)
        // compare 'C' tag
        const coordinateEqual = simulatedNextAction.tags.find(getTag('C'))![1] === nextAction.tags.find(getTag('C'))![1]

        return decimalEqual && coordinateEqual && velocityEqual
      })

      tests.push(resultSimulatedAction)
    }
  } catch (error) {
    console.error(error)
    return false
  }

  // return true if all tests pass
  return tests.every(test => test === true)
}
