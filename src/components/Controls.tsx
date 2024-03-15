import { useContext, useEffect, useRef, useState } from 'react'
import { Avatar } from '../libraries/Avatar.tsx'
import { IdentityContext } from '../providers/IdentityProvider.tsx'
import { IdentityContextType } from '../types/IdentityType.tsx'

export const Controls = () => {

  const { identity } = useContext<IdentityContextType>(IdentityContext)

  const avatarRef = useRef()

  const [throttle, setThrottle] = useState<number>(1)

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

    return () => {
      window.removeEventListener("keydown", handleForward)
      window.removeEventListener("keydown", handleReverse)
      window.removeEventListener("keyup", handleInactive)
      window.removeEventListener("wheel", handleWheel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  return <Avatar ref={avatarRef} pubkey={identity.pubkey}/>
}