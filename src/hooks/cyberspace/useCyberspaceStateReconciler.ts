
// 1. Get EOSE for drift events for the identity.pubkey. "Loading" state until then.
// 2. Query for nearby aggressive events
// 3. Reconcile the avatars state from a chronological timeline of both drift and aggressive events

import { useContext, useEffect, useState, useReducer } from "react"
import * as THREE from "three"
import { Filter } from "nostr-tools"
import { getRelayList, pool } from "../../libraries/Nostr"
import { IdentityContext } from "../../providers/IdentityProvider"
import { IdentityContextType } from "../../types/IdentityType"
import { RelayList } from "../../types/NostrRelay"
import { getVector3FromCyberspaceCoordinate } from "../../libraries/Cyberspace"
import { actionsReducer } from "./actionsReducer"

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
    setPosition(getVector3FromCyberspaceCoordinate(mostRecentAction.tags.find(tag => tag[0] === 'C')![1]))

  }, [actions])

  return [position, velocity, rotation, timestamp]
}
