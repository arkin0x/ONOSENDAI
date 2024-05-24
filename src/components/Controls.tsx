import { useContext, useEffect, useRef, useState } from 'react'
import { IdentityContext } from '../providers/IdentityProvider.tsx'
import { IdentityContextType } from '../types/IdentityType.tsx'
import { useEngine } from '../hooks/cyberspace/useEngine.ts'
import { Quaternion } from 'three'
import { AvatarContext } from '../providers/AvatarContext.tsx'
import { extractActionState } from '../libraries/Cyberspace.ts'
import { useFrame } from '@react-three/fiber'

type ControlState = {
  forward: boolean
  forwardReleased: boolean // true for 1 frame after the forward key is set to false
  reverse: boolean
  reverseReleased: boolean
  respawn: boolean
  freeze: boolean
}

const initialControlState: ControlState = {
  forward: false,
  forwardReleased: false,
  reverse: false,
  reverseReleased: false,
  respawn: false,
  freeze: false,
}

/**
 * The <Controls> component sets up HID input listeners for avatar control and thermodynamic posture control. Input is translated into commands dispatched to Engine for mining and camera control. 
 * @returns null
 */
export const Controls = () => {

  const { identity, relays } = useContext<IdentityContextType>(IdentityContext)
  const pubkey = identity.pubkey
  const engine = useEngine(pubkey, relays)
  const {actionState} = useContext(AvatarContext)
  const actions = actionState[pubkey]
  const controlsRef = useRef<ControlState>(initialControlState)
  const throttleRef = useRef<number>(5)
  const currentRotationRef = useRef<Quaternion>(new Quaternion())

  // console.log('/// CONTROLS RERUN')

  // get the current rotation from the most recent action state and set the currentRotationRef
  useEffect(() => {
    if(!actions || actions.length === 0) {
      // if no action state, set currentRotation to identity rotation
      currentRotationRef.current = new Quaternion()
    } else {
      // debug
      console.log('controls set genesis and latest action')
      // set genesis action
      engine.setGenesisAction(actions[0])
      // set latest action
      engine.setLatestAction(actions[actions.length-1])

      // get rotation from most recent action state
      const latestAction = actions[actions.length-1]
      const {rotation} = extractActionState(latestAction)
      currentRotationRef.current = rotation ?? new Quaternion()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[actions])

  // set up controls for avatar
  // on mount, set up listener for W key to go forward. On unmount, remove listener.
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === "KeyW" || e.key === "ArrowUp") {
      controlsRef.current.forward = true
    } else if (e.code === "KeyS" || e.key === "ArrowDown") {
      controlsRef.current.reverse = true
    } else if (e.code === "Escape") {
      // respawn
      controlsRef.current.respawn = true
    } else if (e.code === "Space") {
      // stop
      controlsRef.current.freeze = true
    }
  }

  const handleKeyUp = (e: KeyboardEvent) => {
    if (e.code === "KeyW" || e.key === "ArrowUp") {
      controlsRef.current.forward = false
      controlsRef.current.forwardReleased = true
    } else if (e.code === "KeyS" || e.key === "ArrowDown") {
      controlsRef.current.reverse = false
      controlsRef.current.reverseReleased = true
    }
  }

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault()
    console.log('wheel: ', throttleRef.current)
    if (e.deltaY > 0) {
      throttleRef.current = Math.min(10, throttleRef.current + 1) // Use a function to update state based on previous state
    } else {
      throttleRef.current = Math.max(0, throttleRef.current - 1)
    }
  }

  // add listeners for the controls
  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    window.addEventListener("wheel", handleWheel)

    // @TODO - set handler for pointer drag to rotate avatar and setCurrentRotation
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
      window.removeEventListener("wheel", handleWheel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // add useFrame to take actions based on controlsRef each frame
  useFrame(() => {
    if(controlsRef.current.respawn) {
      engine.respawn()
      controlsRef.current.respawn = false
      controlsRef.current = initialControlState
      // console.log('respawn')
    }

    if(controlsRef.current.freeze) {
      engine.freeze()
      controlsRef.current.freeze = false
    }
    
    // if forward key is pressed, drift forward
    if (controlsRef.current.forward) {
      engine.drift(throttleRef.current, currentRotationRef.current)
    } else
    // if forward key is up and reverse key is pressed, drift in reverse
    if (controlsRef.current.reverse) {
      engine.drift(throttleRef.current, currentRotationRef.current.clone().invert())
    }

    // reset released flags
    // if forward key is released, stop drifting
    if (!controlsRef.current.forward && controlsRef.current.forwardReleased) {
      engine.stopDrift()
      controlsRef.current.forwardReleased = false
    }
    // if reverse key is released, stop drifting
    if (!controlsRef.current.reverse && controlsRef.current.reverseReleased) {
      engine.stopDrift()
      controlsRef.current.reverseReleased = false
    }
  })

  return null
}