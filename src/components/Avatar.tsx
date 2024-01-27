import { useContext, useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from "@react-three/fiber"
import { FRAME, DRAG, CYBERSPACE_DOWNSCALE, HALF_DOWNSCALED_CYBERSPACE_AXIS } from "../libraries/Cyberspace"
import * as THREE from 'three'
import { useCyberspaceStateReconciler } from '../hooks/cyberspace/useCyberspaceStateReconciler.ts'
import { useEngine } from '../hooks/cyberspace/useEngine.ts'
import { IdentityContext } from '../providers/IdentityProvider.tsx'
import { IdentityContextType } from '../types/IdentityType.tsx'
import { DecimalVector3 } from '../libraries/DecimalVector3.ts'
import { updateHashpowerAllocation } from '../libraries/HashpowerManager.ts'

/**
 * Avatar component
 * @property {string} pubkey - the public key of the operator - @TODO - this should be used to initiate a cyberspaceStateReconciler for this pubkey's avatar.
 * 
 * @description - The Avatar component is a camera + geometry that represents the user's avatar in cyberspace. The position, velocity, and rotation of the avatar is the LERP projection of the latest valid state of the cyberspaceStateReconciler.
 * 
 */

export const Avatar = () => {
  const {identity, relays} = useContext<IdentityContextType>(IdentityContext)
  const [lerpPosition, setLerpPosition] = useState<DecimalVector3>(new DecimalVector3(HALF_DOWNSCALED_CYBERSPACE_AXIS, HALF_DOWNSCALED_CYBERSPACE_AXIS, HALF_DOWNSCALED_CYBERSPACE_AXIS))
  const [lerpVelocity, setLerpVelocity] = useState<DecimalVector3>(new DecimalVector3(0, 0, 0))
  const [currentRotation,] = useState<THREE.Quaternion>(new THREE.Quaternion(0,0,0,1)) // rotation is based on last state + pointer drag
  const [processedTimestamp, setProcessedTimestamp] = useState<number>(Date.now())
  const [throttle, setThrottle] = useState(1)
  const {position, velocity, rotation, simulationHeight, actionChainState} = useCyberspaceStateReconciler()
  const { setGenesisAction, setLatestAction, drift, stopDrift } = useEngine(identity.pubkey, relays)
  const engineReadyRef = useRef(false)

  const { camera } = useThree()

  function setEngineReady(ready: boolean) {
    engineReadyRef.current = ready
  }

  // update Engine with required state and/or let this component know we can start sending action requests to the engine.
  useEffect(() => {
    console.log('actionChainState', actionChainState, engineReadyRef.current)
    if (actionChainState.status === 'valid') {
      // update Engine with valid genesis and latest action
      setGenesisAction(actionChainState.genesisAction)
      setLatestAction(actionChainState.latestAction)
      setEngineReady(true)
    } else if (actionChainState.status === 'invalid') {
      // if the chain is invalid, a new genesis action is required and the engine will make one if it is activated without one.
      setEngineReady(true)
    }
  }, [actionChainState, setGenesisAction, setLatestAction])

  // when the position, velocity, or rotation changes, use this as the basis for a newly calculated LERP position/velocity/rotation
  useEffect(() => {
    // set the avatar's position, based on the most recent state of cyberspace reconciler (action chain vs other avatar's actions)
    setLerpPosition(position)
    setLerpVelocity(velocity)
    setProcessedTimestamp(simulationHeight)
    // we don't set rotation because that is controlled by the user and whatever we receive is likely to be stale.

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, velocity, rotation, simulationHeight, actionChainState])


  // PHYSICS SIMULATION
  // apply physics to the avatar based on state to LERP animation until next state. If last state was a while ago, LERP to current time's simulated position.
  useFrame(() => {
    const timestamp = Date.now()
    const elapsed = (timestamp - processedTimestamp) // milliseconds since last processed frame or last state change
    if (elapsed < FRAME) return // the simulation is already up to date, so don't do anything
    let frames = Math.floor(elapsed / FRAME) // the physics runs at 60 frames per second
    // console.log(frames, 'frames to process')
    let lerpPositionTemp = lerpPosition
    let lerpVelocityTemp = lerpVelocity
    let processedTimestampTemp = processedTimestamp
    while (frames--) {
      if (lerpVelocityTemp.x.eq(0) && lerpVelocityTemp.y.eq(0) && lerpVelocityTemp.z.eq(0)){ // FIXME might need to use almost equal here because a decaying velocity will probabbly never equal exactly zero.
        processedTimestampTemp += FRAME * frames
        // console.log('skipping physics simulation because velocity is 0')
        break // if the velocity is 0, we don't need to do anything
      }
      lerpPositionTemp = lerpPositionTemp.add(lerpVelocityTemp)
      lerpVelocityTemp = lerpVelocityTemp.multiplyScalar(DRAG) // multiply velocity by 0.999 to simulate friction every frame
      processedTimestampTemp += FRAME
    }
    // save the new state (we can't do this mid-loop because the value won't update in useFrame.)
    setLerpPosition(lerpPositionTemp)
    setLerpVelocity(lerpVelocityTemp)
    setProcessedTimestamp(processedTimestampTemp)
  })

  // when the lerp position changes, update the camera's position
  useEffect(() => {
    camera.position.copy(lerpPosition.divideScalar(CYBERSPACE_DOWNSCALE).toVector3())
    camera.quaternion.copy(currentRotation)
    camera.updateProjectionMatrix()
  }, [camera, lerpPosition, currentRotation])

  // set up controls for avatar
  useEffect(() => {
    // on mount, set up listener for W key to go forward. On unmount, remove listener.
    const handleForward = (e: KeyboardEvent) => {
      // console.log(e)
      if (e.code === "KeyW" || e.key === "ArrowUp") {
        // while holding W, mine drift events until one is found of the current throttle or higher or the W key is released.
        console.log('drift')
        driftWrapper(throttle, currentRotation)
      }
    }
    const handleReverse = (e: KeyboardEvent) => {
      if (e.code === "KeyS" || e.key === "ArrowDown") {
        // mine drift events in reverse
        console.log('reverse drift')
        driftWrapper(throttle, currentRotation.clone().invert())
      }
    }
    const handleInactive = () => {
      console.log('stop drift')
      stopDriftWrapper()
    }
    window.addEventListener("keydown", handleForward)
    window.addEventListener("keydown", handleReverse)
    window.addEventListener("keyup", handleInactive)
    
    // set handler for throttle change via scroll wheel
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.deltaY > 0) {
        setThrottle(Math.min(10,throttle + 1))
      } else {
        setThrottle(Math.max(0,throttle - 1))
      }
      console.log(throttle)
    }
    window.addEventListener("wheel", handleWheel)

    // @TODO - set handler for pointer drag to rotate avatar and setCurrentRotation

    updateHashpowerAllocation()

    return () => {
      window.removeEventListener("keydown", handleForward)
      window.removeEventListener("keydown", handleReverse)
      window.removeEventListener("keyup", handleInactive)
      window.removeEventListener("wheel", handleWheel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // functions
  const driftWrapper = (throttle: number, quaternion: THREE.Quaternion) => {
    console.log('drift proxy', engineReadyRef.current)
    if (!engineReadyRef.current) return
    drift(throttle, quaternion)
  }
  const stopDriftWrapper = () => {
    if (!engineReadyRef.current) return
    stopDrift()
  }

  const boxPos = camera.position.clone()
  boxPos.z -= 3
  const boxRef = useRef<THREE.Mesh>(null)

  useFrame(() => {
    if (!boxRef.current) return
    boxRef.current.rotation.x += 0.01
    boxRef.current.rotation.y += 0.01
  })

  return (
    <group>
    <ambientLight intensity={2.0} />
    <mesh ref={boxRef} position={boxPos}>
      <boxGeometry args={[1,1,1]} />
      <meshStandardMaterial color="hotpink" />
    </mesh>
    </group>
  )
}
