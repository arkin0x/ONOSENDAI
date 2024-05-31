import { useContext, useEffect, useRef } from 'react'
import { useThrottleStore } from '../store/ThrottleStore.ts'
import { IdentityContext } from '../providers/IdentityProvider.tsx'
import { IdentityContextType } from '../types/IdentityType.tsx'
import { useEngine } from '../hooks/cyberspace/useEngine.ts'
import { Euler, Quaternion } from 'three'
import { AvatarContext } from '../providers/AvatarContext.tsx'
import { extractActionState } from '../libraries/Cyberspace.ts'
import { useFrame } from '@react-three/fiber'
import { defaultRelays } from '../libraries/Nostr.ts'
import { useControlStore } from '../store/ControlStore.ts'

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
  const { throttle, setThrottle } = useThrottleStore()
  const { controlState, setControlState, resetControlState } = useControlStore()
  const currentRotationRef = useRef<Quaternion>(new Quaternion())
  const inReverse = useRef<boolean>(false)

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
    // console.log('key down', e.code, e.key)
    // forward
    if (e.code === "KeyW" || e.key === "ArrowUp") {
      setControlState({forward: true})

    // cruise (no need to hold down forward)
    } else if (e.code === "KeyX") {
      if (controlState.cruise) {
        setControlState({cruise: false})
      } else {
        setControlState({forward: false})
        setControlState({cruise: true})
      }

    // reverse
    } else if (e.code === "KeyS" || e.key === "ArrowDown") {
      setControlState({reverse: true})


    // pitch up
    } else if (e.code === "KeyR") {
      setControlState({pitchUp: true})

    // pitch down
    } else if (e.code === "KeyF") {
      setControlState({pitchDown: true})

    // yaw left
    } else if (e.code === "KeyQ") {
      setControlState({yawLeft: true})

    // yaw right
    } else if (e.code === "KeyE") {
      setControlState({yawRight: true})

    // respawn
    } else if (e.code === "Escape") {
      setControlState({respawn: true})

    // stop
    } else if (e.code === "Space") {
      setControlState({freeze: true})
    }
  }

  const handleKeyUp = (e: KeyboardEvent) => {
    if (e.code === "KeyW" || e.key === "ArrowUp") {
      setControlState({forward: false})
      setControlState({forwardReleased: true})

    } else if (e.code === "KeyS" || e.key === "ArrowDown") {
      setControlState({reverse: false})
      setControlState({reverseReleased: true})
      inReverse.current = false 

    } else if (e.code === "KeyR") {
      setControlState({pitchUp: false})

    } else if (e.code === "KeyF") {
      setControlState({pitchDown: false})

    } else if (e.code === "KeyQ") {
      setControlState({yawLeft: false})

    } else if (e.code === "KeyE") {
      setControlState({yawRight: false})

    } else if (e.code === "Escape") {
      setControlState({respawn: false})

    } else if (e.code === "Space") {
      setControlState({freeze: false})
    }
  }

  const handleWheel = (e: WheelEvent) => {
    // e.preventDefault()
    if (e.deltaY > 0) {
      // console.log('wheel down', e.deltaY)
      // console.log('throttle', throttle)
      const newThrottle = Math.min(128, throttle + 1)
      // console.log('new throttle', newThrottle)  
      setThrottle(newThrottle)
    } else {
      // console.log('wheel up', e.deltaY)
      // console.log('throttle', throttle)
      const newThrottle = Math.max(0, throttle - 1)
      // console.log('new throttle', newThrottle)  
      setThrottle(newThrottle)
    }
  }
    // console.log('wheel: ', throttle)

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
  }, [throttle, controlState, setControlState, setThrottle])

  // add useFrame to take actions based on controlState each frame
  useFrame(() => {
    if(controlState.respawn) {
      engine.respawn()
      setControlState({respawn: false})
      resetControlState()
      return
    }

    // change rotation
    if (controlState.pitchDown) {
      const rotation = currentRotationRef.current.clone()
      rotation.multiply(new Quaternion().setFromEuler(new Euler(0.01, 0, 0)))
      currentRotationRef.current = rotation
    }

    if (controlState.pitchUp) {
      const rotation = currentRotationRef.current.clone()
      rotation.multiply(new Quaternion().setFromEuler(new Euler(-0.01, 0, 0)))
      currentRotationRef.current = rotation
    }

    if (controlState.yawLeft) {
      const rotation = currentRotationRef.current.clone()
      rotation.multiply(new Quaternion().setFromEuler(new Euler(0, 0.01, 0)))
      currentRotationRef.current = rotation
    }

    if (controlState.yawRight) {
      const rotation = currentRotationRef.current.clone()
      rotation.multiply(new Quaternion().setFromEuler(new Euler(0, -0.01, 0)))
      currentRotationRef.current = rotation
    }
    
    // slow down
    if(controlState.freeze) {
      engine.freeze()
      setControlState({freeze: false})
    }

    if (controlState.cruise) {
      engine.drift(throttle, currentRotationRef.current)
    
    // if not cruising, handle forward and reverse drifts
    } else if (!controlState.cruise) {

      // if forward key is pressed, drift forward
      if (controlState.forward) {
        // const jitter = new Quaternion(currentRotationRef.current.x + Math.random() / 100000, currentRotationRef.current.y + Math.random() / 10000, currentRotationRef.current.z + Math.random() / 10000, currentRotationRef.current.w + Math.random() / 10000)
        // engine.drift(throttleRef.current, jitter)
        engine.drift(throttle, currentRotationRef.current)
      } else
      // if forward key is up and reverse key is pressed, drift in reverse
      if (!controlState.forward && controlState.reverse) {
        if (inReverse.current === false) {
          // if we are not already in reverse, invert the quaternion and drift in reverse
          currentRotationRef.current = currentRotationRef.current.clone().invert()
        }
        inReverse.current = true
        engine.drift(throttle, currentRotationRef.current)
      }

      // reset released flags
      // if forward key is released, stop drifting
      if (!controlState.forward && controlState.forwardReleased) {
        engine.stopDrift()
        setControlState({forwardReleased: false})
      }
      // if reverse key is released, stop drifting
      if (!controlState.reverse && controlState.reverseReleased) {
        engine.stopDrift()
        setControlState({reverseReleased: false})
      }

    }

    // DEBUG check quat
    // console.log(currentRotationRef.current.toArray().join(', '))
  })

  return null
}