import { useContext, useEffect, useState, useReducer } from "react"
import { Decimal } from 'decimal.js'
import * as THREE from "three"
import { Event, Filter } from "nostr-tools"
import { getRelayList, getTagValue, pool } from "../../libraries/Nostr"
import { IdentityContext } from "../../providers/IdentityProvider"
import { IdentityContextType } from "../../types/IdentityType"
import { RelayList } from "../../types/NostrRelay"
import { extractActionState, getVector3FromCyberspaceCoordinate } from "../../libraries/Cyberspace"
import { MillisecondsTimestamp } from "../../types/Cyberspace"
import { actionsReducer } from "./actionsReducer"
import { validateActionChain } from "./validateActionChain"
import { countLeadingZeroesHex } from "../../libraries/Hash"
import { DecimalVector3 } from "../../libraries/DecimalVector3"
import { ActionChainState } from "../../types/Cyberspace"

type CyberspaceStateReconciler = {
  actions: Event[]
  position: DecimalVector3
  velocity: DecimalVector3
  rotation: THREE.Quaternion
  simulationHeight: number
  actionChainState: ActionChainState
}

export const useCyberspaceStateReconciler = (): CyberspaceStateReconciler => {
  const {identity, relays} = useContext<IdentityContextType>(IdentityContext)
  const [actions, saveAction] = useReducer(actionsReducer, []) // this is a dump of all our actions; they may come from the relay pool unordered but the reducer will sort them by timestamp AND purge old actions if a new action chain begins (new genesis event.)
  const [validChain, setValidChain] = useState<boolean>(false) // this will hopefully change from false to true when all actions are sequential (none missing), or, when the whole chain is loaded fully
  const [loadedWholeChain, setLoadedWholeChain] = useState<boolean>(false) // this is set to true when we get EOSE from the relay pool

  // action state vars
  const [simulationHeight, setSimulationHeight] = useState<MillisecondsTimestamp>(0) // the most recent timestamp (ms) that the simulation has been updated to
  const [position, setPosition] = useState<DecimalVector3>(new DecimalVector3(0,0,0))
  const [velocity, setVelocity] = useState<DecimalVector3>(new DecimalVector3(0,0,0))
  const [rotation, setRotation] = useState<THREE.Quaternion>(new THREE.Quaternion(0,0,0,1))

  // This will run whenever identity.pubkey changes to clear our actions and start over.
  useEffect(() => {
    saveAction({type: 'reset'})
  }, [identity.pubkey])

  // retrieve action events, store and validate action chain
  useEffect(() => {
    // TODO: right now we are only getting the user's own actions. We need to get all actions from nearby users at some point.
    const filter: Filter<333> = {kinds: [333], authors: [identity.pubkey]}
    // const relayList: RelayList = getRelayList(relays, ['read'])
    const sub = pool.sub(['wss://cyberspace.nostr1.com'], [filter])
    // get actions from your relays
    sub.on('event', (event) => {
      // save every action
      console.log(event)
      saveAction({type: 'add', payload: event})
      console.log('action chain',actions)
      // recalculate the chain status. An invalid chain can mean we are missing events or it can mean the chain is actually invalid. We need to wait for EOSE to know for sure.
      const chainStatus = validateActionChain(actions)
      setValidChain(chainStatus)
    })
    sub.on('eose', () => {
      console.log('eose')
      setLoadedWholeChain(true)
      // this is only triggered once for a connection (pool)
      // TODO: we need a way to determine if the chain is invalid and will never be valid so, we need to reset the chain and start over.
      // if loadedWholeChain is true and validChain is false, we need to start over with a new genesis event.
    })
    return () => {
      sub.unsub()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity])


  // If the action chain is valid, we can just return the latest action's position/velocity/etc. If it's not valid, we return the home coordinates and zero velocity.
  useEffect(() => {
    if (validChain) {
      // action chain is valid
      // get most recent action
      const latest = actions[actions.length - 1]
      let driftVelocity = new DecimalVector3(0,0,0)

      const { position, velocity, rotation, time } = extractActionState(latest)
      // add POW to velocity if the most recent was a drift event
      if (latest.tags.find(getTagValue('A','drift'))) {
        // quaternion from the action
        // add POW to velocity for drift event
        const POW = countLeadingZeroesHex(latest.id)
        const newVelocity = new Decimal(2).pow(POW)
        const bodyVelocity = new DecimalVector3(0, 0, newVelocity)
        const addedVelocity = bodyVelocity.applyQuaternion(rotation)
        driftVelocity = velocity.add(addedVelocity)
      }
      // set state
      setPosition(position)
      setVelocity(driftVelocity)
      setRotation(rotation)
      setSimulationHeight(time.ms_only)
    } else {
      // set state to home coordinates and zero velocity
      const homeCoord = getVector3FromCyberspaceCoordinate(identity.pubkey)
      setPosition(homeCoord)
      setVelocity(new DecimalVector3(0,0,0))
      setRotation(new THREE.Quaternion(0,0,0,1))
      setSimulationHeight(Date.now())
    }
  }, [validChain, actions, identity])

  let actionChainState: ActionChainState

  if (!loadedWholeChain) {
    actionChainState = { status: 'loading' }
  } else if (!validChain) {
    actionChainState = { status: 'invalid' }
  } else {
    const genesisAction = actions[0]
    const latestAction = actions[actions.length - 1]
    actionChainState = { status: 'valid', genesisAction, latestAction }
  }

  return {actions, position, velocity, rotation, simulationHeight, actionChainState}

}
