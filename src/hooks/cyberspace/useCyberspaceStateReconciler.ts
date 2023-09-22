
// 1. Get EOSE for drift events for the identity.pubkey. "Loading" state until then.
// 2. Query for nearby aggressive events
// 3. Reconcile the avatars state from a chronological timeline of both drift and aggressive events

import { useContext, useEffect, useState, useReducer } from "react"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"
import { Filter } from "nostr-tools"
import { getRelayList, pool } from "../../libraries/Nostr"
import { IdentityContext } from "../../providers/IdentityProvider"
import { IdentityContextType } from "../../types/IdentityType"
import { RelayList } from "../../types/NostrRelay"
import { DRAG, FRAME, getMillisecondsTimestampFromAction, getVector3FromCyberspaceCoordinate } from "../../libraries/Cyberspace"
import { actionsReducer } from "./actionsReducer"
import { ActionsState } from "./actionReducerTypes"

export const useCyberspaceStateReconciler = () => {
  const {identity, relays} = useContext<IdentityContextType>(IdentityContext)
  const [actions, actionDispatch] = useReducer(actionsReducer, [])

  // action state vars
  const [lastActionsState, setLastActionsState] = useState<ActionsState>([])
  const [simulationHeight, setSimulationHeight] = useState<number>(0) // the most recent timestamp (ms) that the simulation has been updated to
  const [position, setPosition] = useState<THREE.Vector3>(new THREE.Vector3(0,0,0))
  const [velocity, setVelocity] = useState<THREE.Vector3>(new THREE.Vector3(0,0,0))
  const [rotation, setRotation] = useState<THREE.Quaternion>(new THREE.Quaternion(0,0,0,1))

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

  // when the actions state updates, check the root event to make sure it's the same as the last state. If valid, copy the new state to the last state. If invalid, trigger a recalculation of position/velocity/etc from the new root.
  useEffect(() => {
    // if the actions state is empty, do nothing
    if (actions.length === 0) {
      return
    }
    // check if the root event is the same as the last state
    const lastRoot = lastActionsState[0]
    const root = actions[0]
    if (lastRoot && root && lastRoot.id !== root.id) {
      // we have a different root, which means our state was invalidated. We need to recalculate our position/velocity/etc from the new action chain. Trigger this now:
      const latest = actions[actions.length - 1]
      setSimulationHeight(getMillisecondsTimestampFromAction(latest))
    }

    // update our last actions state
    setLastActionsState([...actions])
  }, [actions])

  useFrame(({clock}) => {
    if (actions.length === 0) {
      return
    }
    // get most recent action in chain
    const latest = actions[actions.length - 1]
    // get time of last action
    const latest_ts = getMillisecondsTimestampFromAction(latest) // no need for a catch on this, as no invalid actions will be added to the actions state.

    // if the simulation height equals the most recent action's timestamp, we set the position/velocity/etc to the most recent action's values so the simulation can start from there.
    if (latest_ts === simulationHeight) {
      // set position
      setPosition(getVector3FromCyberspaceCoordinate(latest.tags.find(tag => tag[0] === 'C')![1]))
      setVelocity(new THREE.Vector3().fromArray(latest.tags.find(tag => tag[0] === 'velocity')!.slice(1).map(parseFloat)))

    }

    // simuate frames since last action
    const current_ts = Date.now()
    let frames = Math.floor((current_ts - simulationHeight) / FRAME)
    if (frames > 0) setSimulationHeight(current_ts)

    while (frames--) {
      // update velocity with drag
      setVelocity(velocity => velocity.multiplyScalar(DRAG))
      // update position from velocity
      setPosition(position => position.add(velocity))
    }
    
  })

  return [position, velocity, rotation, simulationHeight]
}
