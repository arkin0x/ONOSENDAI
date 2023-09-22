
// 1. Get EOSE for drift events for the identity.pubkey. "Loading" state until then.
// 2. Query for nearby aggressive events
// 3. Reconcile the avatars state from a chronological timeline of both drift and aggressive events

import { useContext, useEffect, useState, useReducer } from "react"
import * as THREE from "three"
import { Filter } from "nostr-tools"
import { getRelayList, pool } from "../libraries/Nostr"
import { IdentityContext } from "../providers/IdentityProvider"
import { IdentityContextType } from "../types/IdentityType"
import { RelayList } from "../types/NostrRelay"
import { countLeadingZeroes } from "../libraries/Hash"
import { FRAME, UNIVERSE_DOWNSCALE, getPlaneFromAction, vector3Equal } from "../libraries/Cyberspace"
import { decodeHexToCoordinates, downscaleCoords } from "../libraries/Constructs"
import { Action } from "../types/Cyberspace"

type ActionsState = Action[]
type ActionsReducer = {
  type: 'add',
  payload: Action
}

const actionChainIsValid = (actions: ActionsState): boolean => {
  const tests = []

  // check the p tags for valid references. Every subsequent action must reference the previous one
  const testHashState = [...actions]
  tests.push(testHashState.reverse().every((action, index) => {
    // the first action in the chain is always valid because it has no predicate to reference
    if (index === testHashState.length - 1) {
      return true
    }
    // check if the next action is referenced in the current action
    const nextAction = testHashState[index + 1]
    if (action.tags.find(tag => tag[0] === 'p' && tag[1] === nextAction.id)) {
      return true
    }
    return false
  }))

  // the following validations only apply if we have more than 1 acton in the chain
  if (actions.length > 1) {

    // check the plane and make sure it is valid
    // TODO: implement portals to switch planes; currently stuck on the starting plane
    const testPlaneState = [...actions]
    const startPlane = getPlaneFromAction(testPlaneState[0])
    const planeIsValid = testPlaneState.reduce<false | 'd-space' | 'c-space'>((plane, action) => {
      // get the plane from the action
      const currPlane = getPlaneFromAction(action)
      if (plane === currPlane) {
        return plane
      } else {
        return false
      }
    }, startPlane)
    tests.push(!!planeIsValid)

    // check the velocity and make sure it is within tolerances
    const testVelocityState = [...actions]
    // running simulated velocity
    const velocity: THREE.Vector3 = new THREE.Vector3(0,0,0)
    tests.push(testVelocityState.every((action, index) => {
      // for all other actions, simulate velocity changes since previous action and compare to this action's recordeded velocity
      try {
        // this action's velocity should match the velocity simulation
        const v = new THREE.Vector3().fromArray(action.tags.find(tag => tag[0] === 'velocity')!.slice(1).map(parseFloat))
        if (!vector3Equal(v, velocity)) {
          // dump action chain
          return false
        }

        // if this is the last action, we're done
        if (index === testVelocityState.length - 1) {
          return true
        }

        // if this is not the last action, simulate velocity until next action

        // 1. add POW as velocity on quaternion
        if (action.tags.find(tag => tag[0] === 'A' && tag[1] === 'drift')) {
          // quaternion from the action
          const q = new THREE.Quaternion().fromArray(action.tags.find(tag => tag[0] === 'quaternion')!.slice(1).map(parseFloat))
          // add POW to velocity for drift event
          const POW = countLeadingZeroes(action.id)
          const newVelocity = Math.pow(2, POW)
          const bodyVelocity = new THREE.Vector3(0,0,newVelocity)
          const addedVelocity = bodyVelocity.applyQuaternion(q)
          velocity.add(addedVelocity)
        }

        // 2. simulate velocity for each frame up to and not including the next action.
        // timestamp with ms
        const start_ts = parseInt(action.tags.find(tag => tag[0] === 'ms')![1]) + action.created_at * 1000 // if there is an error parsing the ms tag, the catch will invalidate the action chain
        // get next action so we can simulate velocity changes between this action and next action.
        const nextAction = testVelocityState[index+1]
        // next action timestamp with ms
        const end_ts = parseInt(nextAction.tags.find(tag => tag[0] === 'ms')![1]) + nextAction.created_at * 1000

        // Using Math.floor() because drag is not applied to the last frame. The next action will calculate drag starting at its own timestamp. The time between the last frame and the next action is variable and will be less than a frame. Technically, operators are penalized with more drag over time if this duration is shorter, and optimizing the length of time between actions is a strategy for maximizing velocity. This is not a bug; to keep things simple we restart the frame clock with each new action, which has the side effect of making this overlap possible.
        let iterations = Math.floor((end_ts - start_ts) / FRAME)
        while ( iterations--) {
          velocity.multiplyScalar(0.999)
        }
        // done simulating velocity. we'll see if it matches the next action in the next iteration of the loop.
        return true
      } catch (error) {
        console.error(error)
        return false
      }
    }))
  }

  // return true if all tests pass
  return tests.every(test => test === true)
}

const actionsReducer = (state: ActionsState, action: ActionsReducer) => {
  // add new action to state
  const newState = [...state, action.payload] as ActionsState
  // sort actions by created_at+ms tag from oldest to newest
  newState.sort((a, b) => {
    const aMs = a.tags.find(tag => tag[0] === 'ms')
    const bMs = b.tags.find(tag => tag[0] === 'ms')
    const aTs = a.created_at * 1000 + (aMs ? parseInt(aMs[1]) : 0)
    const bTs = b.created_at * 1000 + (bMs ? parseInt(bMs[1]) : 0)
    return aTs - bTs
  })
  // validate action chain
  // if action chain is valid, return the new state
  if (actionChainIsValid(newState)) {
    return newState
  }
  // a new event can invalidate the whole current action chain. if action chain is invalid, dump it and only return the latest action that invalidated the old chain
  console.warn('Invalid action chain detected. Dumping old chain and returning latest action.')
  return [action.payload]
}

export const useCyberspaceStateReconciler = () => {
  const {identity, relays} = useContext<IdentityContextType>(IdentityContext)
  const [actions, actionDispatch] = useReducer(actionsReducer, [])

  // action state vars
  const [position, setPosition] = useState<THREE.Vector3>(new THREE.Vector3(0,0,0))
  const [velocity, setVelocity] = useState<THREE.Vector3>(new THREE.Vector3(0,0,0))
  const [rotation, setRotation] = useState<THREE.Quaternion>(new THREE.Quaternion(0,0,0,1))
  const [timestamp, setTimestamp] = useState<number>(0)

  useEffect(() => {
    const filter: Filter<333> = {kinds: [333], authors: [identity.pubkey]}
    const relayList: RelayList = getRelayList(relays, ['read'])
    const sub = pool.sub(relayList, [filter])
    // get actions from your relays
    sub.on('event', (event) => {
      actionDispatch({type: 'add', payload: event})
    })
    sub.on('eose', () => {
      // TODO: does this get triggered multiple times?
      // distill and set [position, velocity, rotation, timestamp] to return
      // TODO: need functions to determine position, velocity, rotation, timestamp from action chain
      // if action chain is valid, the latest action has the valid position, velocity, rotation, timestamp and we can just return that.
    })
  }, [identity, relays])

  useEffect(() => {
    // get most recent action in chain
    const mostRecentAction = actions[actions.length - 1]
    if (!mostRecentAction) {
      return
    }
    // set position
    let position = getVector3FromCyberspaceCoordinate(mostRecentAction.tags.find(tag => tag[0] === 'C')![1])

  }, [actions])

  return [position, velocity, rotation, timestamp]
}

const getVector3FromCyberspaceCoordinate = (coordinate: string): THREE.Vector3 => {
  const big = decodeHexToCoordinates(coordinate)
  const small = downscaleCoords(big, UNIVERSE_DOWNSCALE)
  return new THREE.Vector3(small.x, small.y, small.z)
}