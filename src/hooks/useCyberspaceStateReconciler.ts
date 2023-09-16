
// 1. Get EOSE for drift events for the identity.pubkey. "Loading" state until then.
// 2. Query for nearby aggressive events
// 3. Reconcile the avatars state from a chronological timeline of both drift and aggressive events

import { Event, Filter } from "nostr-tools"
import { useContext, useEffect, useState } from "react"
import * as THREE from "three"
import { getRelayList, pool } from "../libraries/Nostr"
import { IdentityContext } from "../providers/IdentityProvider"
import { IdentityContextType } from "../types/IdentityType"
import { RelayList } from "../types/NostrRelay"
import { countLeadingZeroes } from "../libraries/Hash"
import almostEqual from "almost-equal"

type Action = Event<333> & {
  kind: 333,
}

type ActionsState = Action[]
type ActionsReducer = {
  type: 'add',
  payload: Action
}

const vector3Equal = (a: THREE.Vector3, b: THREE.Vector3): boolean => {
  return almostEqual(a.x, b.x) && almostEqual(a.y, b.y) && almostEqual(a.z, b.z)
}

const actionChainIsValid = (actions: ActionsState): boolean => {
  const tests = []
  // check the p tags for valid references. Every subsequent action must reference the previous one
  let testHashState = [...actions]
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

  // check the velocity and make sure it is within tolerances
  // TODO
  // velocity is multiplied by 0.999 every frame (1000ms/60)
  // get the velocity from the first action in the chain
  // calculate the velocity for each frame from the first action to the last action
  // check if the velocity is within tolerances
  // if the velocity is within tolerances, return true
  // if the velocity is not within tolerances, return false
  // if there is only one action in the chain, return true
  // if there are no actions in the chain, return false
  let testVelocityState = [...actions]
  if (testVelocityState.length > 1) {
    // running simulated velocity
    let velocity: THREE.Vector3 = new THREE.Vector3(0,0,0)
    tests.push(testVelocityState.every((action, index) => {
      // for all other actions, simulate velocity changes since previous action and compare to this action's recordeded velocity
      try {
        // this action's velocity should match the velocity simulation
        const v = new THREE.Vector3().fromArray(action.tags.find(tag => tag[0] === 'velocity')!.slice(1).map(parseFloat))
        if (!vector3Equal(v, velocity)) {
          return false
          // dump action chain
        }
        // simulate velocity until next action
        // 1. add POW as velocity on quaternion
        if (action.tags.find(tag => tag[0] === 'A' && tag[1] === 'drift')) {
          // quaternion from the action
          const q = new THREE.Quaternion().fromArray(action.tags.find(tag => tag[0] === 'quaternion')!.slice(1).map(parseFloat))
          // add POW to velocity for drift event
          const POW = countLeadingZeroes(action.id)
          const bodyVelocity = new THREE.Vector3(0,0,POW)
          const addedVelocity = bodyVelocity.applyQuaternion(q)
          velocity.add(addedVelocity)
        }

        // 2. simulate velocity for each frame up to and not including the next action.
        // drag is not applied to the last frame because the next action will calculate starting at its own timestamp.
        // timestamp with ms
        const start_ts = parseInt(action.tags.find(tag => tag[0] === 'ms')![1]) + action.created_at
        // get next action so we can simulate velocity changes between this action and next action.
        const nextAction = testVelocityState[index+1]
        // next action timestamp with ms
        const end_ts = parseInt(nextAction.tags.find(tag => tag[0] === 'ms')![1]) + nextAction.created_at

        let iterations = Math.floor((end_ts - start_ts) / (1000/60))
        while ( iterations--) {
          velocity.multiplyScalar(0.999)
        }
        // done simulating velocity. we'll see if it matches the next action in the next iteration of the loop.
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
  let newState = [...state, action.payload] as ActionsState
  // sort actions by created_at, ms tag from oldest to newest
  newState.sort((a, b) => {
    const aMs = a.tags.find(tag => tag[0] === 'ms')
    const bMs = b.tags.find(tag => tag[0] === 'ms')
    if (aMs && bMs) {
      return parseInt(aMs[1]) - parseInt(bMs[1])
    } else {
      return 0
    }
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
  const [actions, actionDispatch] = useReducer<ActionsReducer, ActionsState>(actionsReducer, initialState)

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
  return [position, velocity, rotation, timestamp]
}