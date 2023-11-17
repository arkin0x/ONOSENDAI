import { useContext, useEffect, useState } from 'react'
import { useFrame } from "@react-three/fiber"
import { FRAME, DRAG } from "../libraries/Cyberspace"
import * as THREE from 'three'
import { useCyberspaceStateReconciler } from '../hooks/cyberspace/useCyberspaceStateReconciler.ts'
import { move, stopMove } from '../libraries/Engine.ts'
import { IdentityContext } from '../providers/IdentityProvider.tsx'
import { IdentityContextType } from '../types/IdentityType.tsx'
import { GenesisAction, LatestAction } from '../types/Cyberspace.ts'

export const Avatar = () => {
  const {position, velocity, rotation, genesisAction, latestAction} = useCyberspaceStateReconciler()
  const [lerpPosition, setLerpPosition] = useState<THREE.Vector3>(new THREE.Vector3(0, 0, 0))
  const [lerpVelocity, setLerpVelocity] = useState<THREE.Vector3>(new THREE.Vector3(0, 0, 0))
  const [currentRotation, setCurrentRotation] = useState<null|THREE.Quaternion>(null) // rotation is based on last state + pointer drag
  const [processedTimestamp, setProcessedTimestamp] = useState<number>(0)
  const [throttle, setThrottle] = useState(1)
  const {identity, relays} = useContext<IdentityContextType>(IdentityContext)

  // abstract the passing of identity and relays to move().
  const moveProxy = (throttle: number, quaternion: THREE.Quaternion, genesisAction: GenesisAction, latestAction: LatestAction) => {
    move(throttle, quaternion, genesisAction, latestAction, identity, relays)
  }

  useEffect(() => {
    const quat = currentRotation || new THREE.Quaternion(0, 0, 0, 1)
    // on mount, set up listener for W key to go forward. On unmount, remove listener.
    const handleForward = (e: KeyboardEvent) => {
      if (e.key === "w" || e.key === "ArrowUp") {
        // while holding W, mine drift events until one is found of the current throttle or higher or the W key is released.
        moveProxy(throttle, quat, genesisAction, latestAction)
      }
    }
    const handleReverse = (e: KeyboardEvent) => {
      if (e.key === "s" || e.key === "ArrowDown") {
        // mine drift events in reverse
        moveProxy(throttle, quat.clone().invert(), genesisAction, latestAction)
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

    return () => {
      window.removeEventListener("keydown", handleForward)
      window.removeEventListener("keydown", handleReverse)
      window.removeEventListener("keyup", handleInactive)
      window.removeEventListener("wheel", handleWheel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // set the avatar's position, based on the most recent state of cyberspace reconciler (action chain vs other avatar's actions)
    setLerpPosition(position)
    setLerpVelocity(velocity)
    if (!currentRotation) setCurrentRotation(rotation)
    if (timestamp > processedTimestamp) setProcessedTimestamp(timestamp)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, velocity, rotation])

  useFrame(() => {
    // apply physics to the avatar based on state to LERP animation until next state. If last state was a while ago, LERP to current position.
    // start at the timestamp of the state, and calculate the position 60 times per second until the timestamp matches the current Date.now()
    // calculate the 3D position of the avatar based on the statePosition, elapsed time since timestamp, and stateVelocity, and update the lerpPosition
    const elapsed = (Date.now() - processedTimestamp) // milliseconds since last processed frame or last state change
    let frames = Math.floor(elapsed / FRAME) // the physics runs at 60 frames per second
    while (frames > 0) {
      const x = lerpPosition.x + lerpVelocity.x
      const y = lerpPosition.y + lerpVelocity.y
      const z = lerpPosition.z + lerpVelocity.z
      setLerpPosition(new THREE.Vector3(x, y, z))
      // multiply velocity by 0.999 to simulate friction every frame
      setLerpVelocity(new THREE.Vector3(lerpVelocity.x * DRAG, lerpVelocity.y * DRAG, lerpVelocity.z * DRAG))
      setProcessedTimestamp(processedTimestamp + FRAME)
      frames--
    }
  })

  const euler = new THREE.Euler()
  euler.setFromQuaternion(currentRotation || new THREE.Quaternion(0, 0, 0, 1))

  return (
    <camera position={lerpPosition} rotation={euler} />
  )
}
