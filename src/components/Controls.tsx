import { useContext, useEffect, useRef, useState } from 'react'
import { IdentityContext } from '../providers/IdentityProvider.tsx'
import { IdentityContextType } from '../types/IdentityType.tsx'
import { useEngine } from '../hooks/cyberspace/useEngine.ts'
import { Quaternion } from 'three'
import { AvatarContext } from '../providers/AvatarContext.tsx'
import { extractActionState } from '../libraries/Cyberspace.ts'

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
  const [throttle, setThrottle] = useState<number>(5)
  const currentRotationRef = useRef<Quaternion>(new Quaternion())

  console.log('actions',actions)

  // get the current rotation from the most recent action state and set the currentRotationRef
  useEffect(() => {
    if(!actions || actions.length === 0) {
      // if no action state, set currentRotation to identity rotation
      currentRotationRef.current = new Quaternion()
    } else {
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
  useEffect(() => {
    // on mount, set up listener for W key to go forward. On unmount, remove listener.
    const handleForward = (e: KeyboardEvent) => {
      // console.log(e)
      if (e.code === "KeyW" || e.key === "ArrowUp") {
        // while holding W, mine drift events until one is found of the current throttle or higher or the W key is released.
        engine.drift(throttle, currentRotationRef.current)
      }
    }
    const handleReverse = (e: KeyboardEvent) => {
      if (e.code === "KeyS" || e.key === "ArrowDown") {
        // mine drift events in reverse
        console.log('reverse drift')
        engine.drift(throttle, currentRotationRef.current.clone().invert())
      }
    }
    const handleInactive = () => {
      console.log('stop drift')
      engine.stopDrift()
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


  return null
}