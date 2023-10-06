
// 1. Get EOSE for drift events for the identity.pubkey. "Loading" state until then.
// 2. Query for nearby aggressive events
// 3. Reconcile the avatars state from a chronological timeline of both drift and aggressive events

import { useContext, useEffect, useState, useReducer } from "react"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"
import { Filter } from "nostr-tools"
import { getRelayList, getTag, pool } from "../../libraries/Nostr"
import { IdentityContext } from "../../providers/IdentityProvider"
import { IdentityContextType } from "../../types/IdentityType"
import { RelayList } from "../../types/NostrRelay"
import { DRAG, FRAME, getMillisecondsTimestampFromAction, getVector3FromCyberspaceCoordinate } from "../../libraries/Cyberspace"
import { actionsReducer } from "./actionsReducer"
import { ActionsState } from "./actionReducerTypes"
import { validateActionChain } from "./validateActionChain"

export const useCyberspaceStateReconciler = () => {
  const {identity, relays} = useContext<IdentityContextType>(IdentityContext)
  const [actions, saveAction] = useReducer(actionsReducer, []) // this is a dump of all our actions in whatever order they came from the relay pool
  const [validChain, setValidChain] = useState<boolean>(false) // this will hopefully change from false to true when all actions are sequential (none missing), or, when the whole chain is loaded fully
  const [loadedWholeChain, setLoadedWholeChain] = useState<boolean>(false) // this is set to true when we get EOSE from the relay pool

  // action state vars
  const [simulationHeight, setSimulationHeight] = useState<number>(0) // the most recent timestamp (ms) that the simulation has been updated to
  const [position, setPosition] = useState<THREE.Vector3>(new THREE.Vector3(0,0,0))
  const [velocity, setVelocity] = useState<THREE.Vector3>(new THREE.Vector3(0,0,0))
  const [rotation, setRotation] = useState<THREE.Quaternion>(new THREE.Quaternion(0,0,0,1))

  // retrieve action events, store and validate action chain
  useEffect(() => {
    const filter: Filter<333> = {kinds: [333], authors: [identity.pubkey]}
    const relayList: RelayList = getRelayList(relays, ['read'])
    const sub = pool.sub(relayList, [filter])
    // get actions from your relays
    sub.on('event', (event) => {
      // save every action
      saveAction({type: 'add', payload: event})
      // recalculate the chain status. An invalid chain can mean we are missing events or it can mean the chain is actually invalid. We need to wait for EOSE to know for sure.
      const chainStatus = validateActionChain(actions)
      setValidChain(chainStatus)
    })
    sub.on('eose', () => {
      setLoadedWholeChain(true)
      // this is only triggered once for a connection (pool)
      // distill and set [position, velocity, rotation, timestamp] to return
      // TODO: need functions to determine position, velocity, rotation, timestamp from action chain
      // if action chain is valid, the latest action has the valid position, velocity, rotation, timestamp and we can just return that.
      // TODO: we need a way to determine if the chain is invalid and will never be valid so, we need to reset the chain and start over.
    })
    return () => {
      sub.unsub()
    }
  }, [identity, relays])


  // If the action chain is valid, we can just return the latest action's position/velocity/etc. If it's not valid, we return the home coordinates and zero velocity.

  useEffect(() => {
    if (validChain) {
      // get most recent action
      const latest = actions[actions.length - 1]
      // get position
      const position = getVector3FromCyberspaceCoordinate(latest.tags.find(getTag('C'))![1])
      // get velocity
      const velocity = new THREE.Vector3().fromArray(latest.tags.find(getTag('velocity'))!.slice(1).map(parseFloat))
      // get rotation
      const rotation = new THREE.Quaternion().fromArray(latest.tags.find(getTag('quaternion'))!.slice(1).map(parseFloat))
      // get timestamp
      const timestamp = getMillisecondsTimestampFromAction(latest)
      // set state
      setPosition(position)
      setVelocity(velocity)
      setRotation(rotation)
      setSimulationHeight(timestamp)

      // TODO: simulate frames from last action to NOW.
    } else {
      // set state to home coordinates and zero velocity
      // setPosition( translate pubkey into cyberspace coordinates )
      setVelocity(new THREE.Vector3(0,0,0))
      setRotation(new THREE.Quaternion(0,0,0,1))
      setSimulationHeight(0)
    }
  })

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
