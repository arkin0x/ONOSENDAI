import { useContext, useEffect, useRef } from 'react'
import { useThrottleStore } from '../stores/throttleStore'
import { IdentityContext } from '../providers/IdentityProvider.tsx'
import { IdentityContextType } from '../types/IdentityType.tsx'
import { useEngine } from '../hooks/cyberspace/useEngine.ts'
import { Euler, Quaternion } from 'three'
import { AvatarContext } from '../providers/AvatarContext.tsx'
import { extractActionState } from '../libraries/Cyberspace.ts'
import { useFrame } from '@react-three/fiber'
import { defaultRelays } from '../libraries/Nostr.ts'

type ControlState = {
  forward: boolean
  forwardReleased: boolean // true for 1 frame after the forward key is set to false
  reverse: boolean
  reverseReleased: boolean
  respawn: boolean
  freeze: boolean
  pitchUp: boolean
  pitchDown: boolean
  yawLeft: boolean
  yawRight: boolean
}

const initialControlState: ControlState = {
  forward: false,
  forwardReleased: false,
  reverse: false,
  reverseReleased: false,
  respawn: false,
  freeze: false,
  pitchUp: false,
  pitchDown: false,
  yawLeft: false,
  yawRight: false,
}

/**
 * The <Controls> component sets up HID input listeners for avatar control and thermodynamic posture control. Input is translated into commands dispatched to Engine for mining and camera control. 
 * @returns null
 */
export const Controls = () => {

  const { identity } = useContext<IdentityContextType>(IdentityContext)
  const pubkey = identity.pubkey
  const engine = useEngine(pubkey, defaultRelays)
  const {actionState} = useContext(AvatarContext)
  const actions = actionState[pubkey]
  const controlsRef = useRef<ControlState>(initialControlState)
  const throttleStore = useThrottleStore()
  const currentRotationRef = useRef<Quaternion>(new Quaternion())
  const inReverse = useRef<boolean>(false)

  // console.log('/// CONTROLS RERUN')
  useEffect(() => {
    const test = new Quaternion()
    console.log('test quat', test)
    const test2 = test.invert()
    console.log('test inv', test2)
  },[])

  // get the current rotation from the most recent action state and set the currentRotationRef
  useEffect(() => {
    if(!actions || actions.length === 0) {
      // if no action state, set currentRotation to identity rotation
      currentRotationRef.current = new Quaternion()
    } else {
      // debug
      // console.log('controls set genesis and latest action')
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
    console.log('key down', e.code, e.key)
    // forward
    if (e.code === "KeyW" || e.key === "ArrowUp") {
      controlsRef.current.forward = true

    // reverse
    } else if (e.code === "KeyS" || e.key === "ArrowDown") {
      controlsRef.current.reverse = true

    // pitch up
    } else if (e.code === "KeyR") {
      controlsRef.current.pitchUp = true

    // pitch down
    } else if (e.code === "KeyF") {
      controlsRef.current.pitchDown = true

    // yaw left
    } else if (e.code === "KeyQ") {
      controlsRef.current.yawLeft = true

    // yaw right
    } else if (e.code === "KeyE") {
      controlsRef.current.yawRight = true

    // respawn
    } else if (e.code === "Escape") {
      controlsRef.current.respawn = true

    // stop
    } else if (e.code === "Space") {
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
      inReverse.current = false 

    } else if (e.code === "KeyR") {
      controlsRef.current.pitchUp = false

    } else if (e.code === "KeyF") {
      controlsRef.current.pitchDown = false

    } else if (e.code === "KeyQ") {
      controlsRef.current.yawLeft = false

    } else if (e.code === "KeyE") {
      controlsRef.current.yawRight = false

    } else if (e.code === "Escape") {
      controlsRef.current.respawn = false

    } else if (e.code === "Space") {
      controlsRef.current.freeze = false
    }
  }

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault()
    if (e.deltaY > 0) {
      // console.log('wheel down', e.deltaY)
      throttleStore.setThrottle(Math.min(128, throttleStore.throttle + 1))
    } else {
      // console.log('wheel up', e.deltaY)
      throttleStore.setThrottle(Math.max(0, throttleStore.throttle - 1))
    }
    console.log('wheel: ', throttleStore.throttle)
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

    // change rotation
    if (controlsRef.current.pitchDown) {
      const rotation = currentRotationRef.current.clone()
      rotation.multiply(new Quaternion().setFromEuler(new Euler(0.01, 0, 0)))
      currentRotationRef.current = rotation
    }

    if (controlsRef.current.pitchUp) {
      const rotation = currentRotationRef.current.clone()
      rotation.multiply(new Quaternion().setFromEuler(new Euler(-0.01, 0, 0)))
      currentRotationRef.current = rotation
    }

    if (controlsRef.current.yawLeft) {
      const rotation = currentRotationRef.current.clone()
      rotation.multiply(new Quaternion().setFromEuler(new Euler(0, 0.01, 0)))
      currentRotationRef.current = rotation
    }

    if (controlsRef.current.yawRight) {
      const rotation = currentRotationRef.current.clone()
      rotation.multiply(new Quaternion().setFromEuler(new Euler(0, -0.01, 0)))
      currentRotationRef.current = rotation
    }
    
    // if forward key is pressed, drift forward
    if (controlsRef.current.forward) {
      // const jitter = new Quaternion(currentRotationRef.current.x + Math.random() / 100000, currentRotationRef.current.y + Math.random() / 10000, currentRotationRef.current.z + Math.random() / 10000, currentRotationRef.current.w + Math.random() / 10000)
      // engine.drift(throttleRef.current, jitter)
      engine.drift(throttleStore.throttle, currentRotationRef.current)
    } else
    // if forward key is up and reverse key is pressed, drift in reverse
    if (!controlsRef.current.forward && controlsRef.current.reverse) {
      if (inReverse.current === false) {
        // if we are not already in reverse, invert the quaternion and drift in reverse
        currentRotationRef.current = currentRotationRef.current.clone().invert()
      }
      inReverse.current = true
      engine.drift(throttleStore.throttle, currentRotationRef.current)
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
    // check quat
    console.log(currentRotationRef.current.toArray().join(', '))
  })

  return null
}