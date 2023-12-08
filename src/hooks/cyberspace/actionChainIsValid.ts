import * as THREE from "three"
import { countLeadingZeroes } from "../../libraries/Hash"
import { DRAG, FRAME, decimalAlmostEqual, getMillisecondsTimestampFromAction, getPlaneFromAction, vector3Equal } from "../../libraries/Cyberspace"
import { ActionsState } from "./actionReducerTypes"
import { getTag, getTagValue } from "../../libraries/Nostr"
import { DecimalVector3 } from "../../libraries/DecimalVector3"
import Decimal from "decimal.js"

export const actionChainIsValid = (actions: ActionsState): boolean => {
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
      if (action.tags.find(getTagValue('e',nextAction.id))) {
        return true
      }
      return false
    }))

    // TEST 2 - NO FUTURE ACTIONS
    // most recent action must be now or in the past, but not in the future 
    const testLatestActionTimestampState = actions[LAST_INDEX]
    const latest_ts = getMillisecondsTimestampFromAction(testLatestActionTimestampState)
    const current_ts = Date.now()
    tests.push(latest_ts <= current_ts)


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
      }, getMillisecondsTimestampFromAction(testTimestampSequenceState[0]))
      tests.push(!!timestampSequenceIsValid)

      // TEST 5 - VALID PLANES
      // check the plane and make sure it is valid
      // TODO: implement portals to switch planes; currently stuck on the starting plane
      const testPlaneState = [...actions]
      const startPlane = getPlaneFromAction(GENESIS_ACTION)
      const planeIsValid = testPlaneState.reduce<false | 'd-space' | 'i-space'>((plane, action) => {
        // get the plane from the action
        const currPlane = getPlaneFromAction(action)
        if (plane === currPlane) {
          return plane
        } else {
          return false
        }
      }, startPlane)
      tests.push(!!planeIsValid)

      // TEST 6 - VALID VELOCITY
      // check the velocity and make sure it is within tolerances
      // TODO: also check position!!! probably makes sense to do that here too.
      const testVelocityState = [...actions]
      // running simulated velocity
      let simulatedVelocity: DecimalVector3 = new DecimalVector3(0, 0, 0)
      tests.push(testVelocityState.every((action, index) => {
        // for all other actions, simulate velocity changes since previous action and compare to this action's recordeded velocity
        // this action's velocity should match the velocity simulation
        // get velocity from action and parse values into a vector3
        const v = new DecimalVector3().fromArray(action.tags.find(getTag('velocity'))!.slice(1))
        if (!v.almostEqual(simulatedVelocity)) {
          return false
        }

        // if this is the last action, we're done
        if (index === LAST_INDEX) {
          return true
        }

        // if this is not the last action, simulate velocity until next action

        // 1. for drift eventns, add POW as velocity on quaternion
        if (action.tags.find(getTagValue('A','drift'))) {
          // quaternion from the action
          const q = new THREE.Quaternion().fromArray(action.tags.find(getTag('quaternion'))!.slice(1).map(parseFloat))
          // add POW to velocity for drift event
          const POW = countLeadingZeroes(action.id)
          const newVelocity = new Decimal(2).pow(POW)
          const bodyVelocity = new DecimalVector3(0, 0, newVelocity)
          const addedVelocity = bodyVelocity.applyQuaternion(q)
          simulatedVelocity = simulatedVelocity.add(addedVelocity)
        }

        // 2. simulate velocity for each frame up to and not including the next action.
        // timestamp with ms
        // NOTE: we have the getMillisecondsTimestampFromActions function but we aren't using it here because we want to validate that the millisecond tags are within valid ranges.
        const start_ms = parseInt(action.tags.find(getTag('ms'))![1])
        // ms must only be within 0-999
        if (start_ms < 0 || start_ms > 999) return false
        const start_ts = start_ms + action.created_at * 1000

        // get next action so we can simulate velocity changes between this action and next action.
        const nextAction = testVelocityState[index + 1]
        // next action timestamp with ms
        const end_ms = parseInt(nextAction.tags.find(getTag('ms'))![1])
        if (end_ms < 0 || end_ms > 999) return false
        const end_ts = end_ms + nextAction.created_at * 1000

        // Using Math.floor() because drag is not applied to the last frame. The next action will calculate drag starting at its own timestamp. The time between the last frame and the next action is variable and will be less than a frame. Technically, operators are penalized with more drag over time if this duration is shorter, and optimizing the length of time between actions is a strategy for maximizing velocity. This is not a bug; to keep things simple we restart the frame clock with each new action, which has the side effect of making this overlap possible.
        let iterations = Math.floor((end_ts - start_ts) / FRAME)
        while (iterations--) {
          simulatedVelocity = simulatedVelocity.multiplyScalar(DRAG)
        }
        // done simulating velocity. we'll see if it matches the next action in the next iteration of the loop.
        return true
      }))
    }
  } catch (error) {
    console.error(error)
    return false
  }

  // return true if all tests pass
  return tests.every(test => test === true)
}
