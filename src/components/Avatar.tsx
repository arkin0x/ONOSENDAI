import { useContext, useEffect, useState } from 'react'
import { useFrame, useThree } from "@react-three/fiber"
import { FRAME, DRAG, CYBERSPACE_DOWNSCALE, DOWNSCALED_CYBERSPACE_AXIS, HALF_DOWNSCALED_CYBERSPACE_AXIS } from "../libraries/Cyberspace"
import * as THREE from 'three'
import { useCyberspaceStateReconciler } from '../hooks/cyberspace/useCyberspaceStateReconciler.ts'
import { move, stopMove } from '../libraries/Engine.ts'
import { IdentityContext } from '../providers/IdentityProvider.tsx'
import { IdentityContextType } from '../types/IdentityType.tsx'
import { GenesisAction, LatestAction } from '../types/Cyberspace.ts'
import { DecimalVector3 } from '../libraries/DecimalVector3.ts'

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
  const [currentRotation, setCurrentRotation] = useState<THREE.Quaternion>(new THREE.Quaternion(0,0,0,1)) // rotation is based on last state + pointer drag
  const [processedTimestamp, setProcessedTimestamp] = useState<number>(Date.now())
  const [throttle, setThrottle] = useState(1)
  const {position, velocity, rotation, simulationHeight, genesisAction, latestAction} = useCyberspaceStateReconciler()

  // const position = new DecimalVector3(HALF_DOWNSCALED_CYBERSPACE_AXIS, HALF_DOWNSCALED_CYBERSPACE_AXIS, HALF_DOWNSCALED_CYBERSPACE_AXIS)
  // const velocity = new DecimalVector3(0, 0, 0)
  // const rotation = new THREE.Quaternion(0,0,0,1)
  // const simulationHeight = Date.now()
  // const genesisAction = null
  // const latestAction = null

  // handle camera
  const { camera } = useThree()

  camera.far = DOWNSCALED_CYBERSPACE_AXIS * 2

  // when the position, velocity, or rotation changes, use this as the basis for a newly calculated LERP position/velocity/rotation
  useEffect(() => {
    // set the avatar's position, based on the most recent state of cyberspace reconciler (action chain vs other avatar's actions)
    setLerpPosition(position)
    setLerpVelocity(velocity)
    setProcessedTimestamp(simulationHeight)
    // we don't set rotation because that is controlled by the user and whatever we receive is likely to be stale.

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, velocity, rotation, simulationHeight, genesisAction, latestAction])

  useFrame(() => {
    // apply physics to the avatar based on state to LERP animation until next state. If last state was a while ago, LERP to current position.
    const timestamp = Date.now()
    const elapsed = (timestamp - processedTimestamp) // milliseconds since last processed frame or last state change
    if (elapsed < FRAME) return // the simulation is already up to date, so don't do anything
    let frames = Math.floor(elapsed / FRAME) // the physics runs at 60 frames per second
    console.log(frames, 'frames to process')
    while (frames--) {
      setLerpPosition(lerpPosition.add(lerpVelocity))
      setLerpVelocity(lerpVelocity.multiplyScalar(DRAG)) // multiply velocity by 0.999 to simulate friction every frame
      setProcessedTimestamp(processedTimestamp + FRAME)
    }
  })

  // when the lerp position changes, update the camera's position
  useEffect(() => {
    camera.position.copy(lerpPosition.divideScalar(CYBERSPACE_DOWNSCALE).toVector3())
    camera.quaternion.copy(currentRotation)
    camera.updateProjectionMatrix()
  }, [camera, lerpPosition, currentRotation])

  // abstract the passing of identity and relays to move().
  const moveProxy = (throttle: number, quaternion: THREE.Quaternion, genesisAction: GenesisAction, latestAction: LatestAction) => {
    move(throttle, quaternion, genesisAction, latestAction, identity, relays)
  }

  // set up controls for avatar
  useEffect(() => {
    // on mount, set up listener for W key to go forward. On unmount, remove listener.
    const handleForward = (e: KeyboardEvent) => {
      if (e.key === "w" || e.key === "ArrowUp") {
        // while holding W, mine drift events until one is found of the current throttle or higher or the W key is released.
        moveProxy(throttle, currentRotation, genesisAction, latestAction)
      }
    }
    const handleReverse = (e: KeyboardEvent) => {
      if (e.key === "s" || e.key === "ArrowDown") {
        // mine drift events in reverse
        moveProxy(throttle, currentRotation.clone().invert(), genesisAction, latestAction)
      }
    }
    const handleInactive = () => {
      stopMove()
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

    return () => {
      window.removeEventListener("keydown", handleForward)
      window.removeEventListener("keydown", handleReverse)
      window.removeEventListener("keyup", handleInactive)
      window.removeEventListener("wheel", handleWheel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    null
  )
}
