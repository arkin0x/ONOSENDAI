import { useContext, useEffect, useState, useReducer } from "react"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"
import { Filter } from "nostr-tools"
import { getRelayList, getTag, getTagValue, pool } from "../../libraries/Nostr"
import { IdentityContext } from "../../providers/IdentityProvider"
import { IdentityContextType } from "../../types/IdentityType"
import { RelayList } from "../../types/NostrRelay"
import { DRAG, FRAME, getMillisecondsTimestampFromAction, getVector3FromCyberspaceCoordinate } from "../../libraries/Cyberspace"
import { Action } from "../../types/Cyberspace"
import { actionsReducer } from "./actionsReducer"
import { validateActionChain } from "./validateActionChain"
import { countLeadingZeroes } from "../../libraries/Hash"

type CyberspaceStateReconciler = {
  actions: Action[]
  position: BigVector3
  velocity: BigVector3
  rotation: THREE.Quaternion
  simulationHeight: number
  genesisAction: Action | boolean
  latestAction: Action | false 
}

class BigVector3 {
  x: bigint
  y: bigint
  z: bigint
  precision: bigint = 1_000_000n // store 6 decimal places in the bigint

  constructor(x: number|bigint = 0, y: number|bigint = 0, z: number|bigint = 0) {
    this.x = BigInt(x) * this.precision
    this.y = BigInt(y) * this.precision
    this.z = BigInt(z) * this.precision
  }

  fromArray(arr: (number|bigint)[]): BigVector3 {
    if (arr.length !== 3) {
      throw new Error('Array must contain exactly three elements')
    }
    this.x = BigInt(arr[0])
    this.y = BigInt(arr[1])
    this.z = BigInt(arr[2])
    return this
  }
  
	applyQuaternion( q: THREE.Quaternion ) {

		const x = this.x, y = this.y, z = this.z
		const qx = q.x, qy = q.y, qz = q.z, qw = q.w

		// calculate quat * vector

		const ix = qw * x + qy * z - qz * y
		const iy = qw * y + qz * x - qx * z
		const iz = qw * z + qx * y - qy * x
		const iw = - qx * x - qy * y - qz * z

		// calculate result * inverse quat

		this.x = ix * qw + iw * - qx + iy * - qz - iz * - qy
		this.y = iy * qw + iw * - qy + iz * - qx - ix * - qz
		this.z = iz * qw + iw * - qz + ix * - qy - iy * - qx

		return this

	}
}

export const useCyberspaceStateReconciler = (): CyberspaceStateReconciler => {
  const {identity, relays} = useContext<IdentityContextType>(IdentityContext)
  const [actions, saveAction] = useReducer(actionsReducer, []) // this is a dump of all our actions; they may come from the relay pool unordered but the reducer will sort them by timestamp AND purge old actions if a new action chain begins (new genesis event.)
  const [validChain, setValidChain] = useState<boolean>(false) // this will hopefully change from false to true when all actions are sequential (none missing), or, when the whole chain is loaded fully
  const [loadedWholeChain, setLoadedWholeChain] = useState<boolean>(false) // this is set to true when we get EOSE from the relay pool

  // action state vars
  const [simulationHeight, setSimulationHeight] = useState<number>(0) // the most recent timestamp (ms) that the simulation has been updated to
  const [position, setPosition] = useState<BigVector3>(new BigVector3(0,0,0))
  const [velocity, setVelocity] = useState<BigVector3>(new BigVector3(0,0,0))
  const [rotation, setRotation] = useState<THREE.Quaternion>(new THREE.Quaternion(0,0,0,1))

  // retrieve action events, store and validate action chain
  useEffect(() => {
    // TODO: right now we are only getting the user's own actions. We need to get all actions from nearby users at some point.
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
      // TODO: we need a way to determine if the chain is invalid and will never be valid so, we need to reset the chain and start over.
      // if loadedWholeChain is true and validChain is false, we need to start over with a new genesis event.
    })
    return () => {
      sub.unsub()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  // If the action chain is valid, we can just return the latest action's position/velocity/etc. If it's not valid, we return the home coordinates and zero velocity.
  useEffect(() => {
    if (validChain) {
      // action chain is valid
      // get most recent action
      const latest = actions[actions.length - 1]
      // get position
      const position = getVector3FromCyberspaceCoordinate(latest.tags.find(getTag('C'))![1])
      // get velocity
      const velocity = new BigVector3().fromArray(latest.tags.find(getTag('velocity'))!.slice(1).map(parseFloat))
      // get rotation
      const rotation = new THREE.Quaternion().fromArray(latest.tags.find(getTag('quaternion'))!.slice(1).map(parseFloat))
      // add POW to velocity if the most recent was a drift event
      if (latest.tags.find(getTagValue('A','drift'))) {
        // quaternion from the action
        // add POW to velocity for drift event
        const POW = countLeadingZeroes(latest.id)
        const newVelocity = Math.pow(2, POW)
        const bodyVelocity = new BigVector3(0, 0, newVelocity)
        const addedVelocity = bodyVelocity.applyQuaternion(rotation)
        velocity.add(addedVelocity)
      }
      // get timestamp
      const timestamp = getMillisecondsTimestampFromAction(latest)
      // set state
      setPosition(position)
      setVelocity(velocity)
      setRotation(rotation)
      setSimulationHeight(timestamp)
    } else {
      // set state to home coordinates and zero velocity
      // setPosition( translate pubkey into cyberspace coordinates )
      setVelocity(new BigVector3(0,0,0))
      setRotation(new THREE.Quaternion(0,0,0,1))
      setSimulationHeight(0)
    }
  }, [validChain, actions])

  useFrame(() => {
    if (actions.length === 0) {
      return
    }

    const current_ts = Date.now()

    if (current_ts < simulationHeight) {
      return
    }

    // simuate frames since last action
    let frames = Math.floor((current_ts - simulationHeight) / FRAME)
    if (frames > 0) setSimulationHeight(Math.floor(frames * FRAME) + simulationHeight)

    while (frames--) {
      // update velocity with drag
      setVelocity(velocity => velocity.multiplyScalar(DRAG))
      // update position from velocity
      setPosition(position => position.add(velocity))
    }
    
  })

  // genesisAction can be one of the following values:
  // - false: we have not loaded the whole chain yet, so please wait
  // - true: we have loaded the whole chain and it is invalid, so we need to start over with a new genesis event. TRUE MEANS THE CHAIN IS INVALID! AND WE NEED TO START OVER.
  // - Action: we have loaded the whole chain and it is valid, so this is the genesis event
  const genesisAction = loadedWholeChain ? validChain ? actions[0] : true : false

  // latestAction wil be one of the following values:
  // - false: we don't have any actions yet
  // - Action: the most recent action in the chain; if the chain is only 1 action long, this is the genesis action
  // - it won't ever be true.
  const latestAction = actions.length > 0 ? actions[actions.length - 1] : false

  return {actions, position, velocity, rotation, simulationHeight, genesisAction, latestAction}
}
