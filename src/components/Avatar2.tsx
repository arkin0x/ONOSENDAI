import { useContext, useEffect, useRef, useState } from 'react'
import { useCyberspaceStateReconciler } from '../hooks/cyberspace/useCyberspaceStateReconciler'
import { useEngine } from '../hooks/cyberspace/useEngine'
import { IdentityContext } from '../providers/IdentityProvider'
import { Quaternion, Vector2, Vector3 } from 'three'
import { CYBERSPACE_DOWNSCALE, DOWNSCALED_CYBERSPACE_AXIS, HALF_DOWNSCALED_CYBERSPACE_AXIS, createUnsignedGenesisAction } from '../libraries/Cyberspace'
import { publishEvent } from '../libraries/Nostr'
import { useFrame, useThree } from '@react-three/fiber'
import { DecimalVector3 } from '../libraries/DecimalVector3'

// DEBUG RELAY ONLY
const DEBUG_RELAY = { 'wss://cyberspace.nostr1.com': { read: true, write: true } }

// LEFTOFF - treat tester as our new avatar class and build it up from the ground up. There is a memory leak in Avatar. see if we can utilize the engine to do the same thing as the avatar class but without modifying the display/camera.
export const Avatar2 = () => {
  const { actions, position, velocity, rotation, simulationHeight, actionChainState } = useCyberspaceStateReconciler()

  const { identity } = useContext(IdentityContext)

  const { drift, stopDrift, setGenesisAction, setLatestAction } = useEngine(identity.pubkey, DEBUG_RELAY)

  const { camera } = useThree()

  camera.far = DOWNSCALED_CYBERSPACE_AXIS * 2

  const engineReadyRef = useRef(false) // used for UI to show when the engine is ready
  const currentRotation = useRef<Quaternion|null>(null)

  const throttle = useRef(1)

  const dragStart = useRef(new Vector2())
  const dragEnd = useRef(new Vector2())

  useEffect(() => {
    // on mount, set up listener for W key to go forward. On unmount, remove listener.
    const handleForward = (e: KeyboardEvent) => {
      // console.log(e)
      if (e.code === "KeyW" || e.key === "ArrowUp") {
        // while holding W, mine drift events until one is found of the current throttle or higher or the W key is released.
        // console.log('drift')
        driftWrapper(throttle.current, currentRotation.current)
      }
    }
    const handleReverse = (e: KeyboardEvent) => {
      if (e.code === "KeyS" || e.key === "ArrowDown") {
        // mine drift events in reverse
        // console.log('reverse drift')
        if (currentRotation.current) {
          driftWrapper(throttle.current, currentRotation.current.clone().invert())
        }
      }
    }
    const handleInactive = (e: KeyboardEvent) => {
      if (e.code === "KeyS" || e.key === "ArrowDown" || e.code === "KeyW" || e.key === "ArrowUp") {
        console.log('stop drift')
        stopDriftWrapper()
      }
      if (e.code === "Escape") {
        restartChain()
      }
    }
    const restartChain = async () => {
      const genesisAction = createUnsignedGenesisAction(identity.pubkey);
      const genesisActionPublished = await publishEvent(genesisAction, DEBUG_RELAY) // FIXME we would normally pass in `relays` here
      console.warn('Restarting Action Chain with Genesis Action:', genesisActionPublished);
    }

    const handlePointerDown = (event: PointerEvent) => {
      dragStart.current.set(event.clientX, event.clientY)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.buttons !== 1) return // Only respond to left mouse button drags

      const movementX = event.movementX
      const movementY = event.movementY

      // Create quaternion rotations for the x and y axes
      const quaternionX = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -movementX * 0.002);
      const quaternionY = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -movementY * 0.002);

      if (!currentRotation.current) {
        currentRotation.current = new Quaternion()
      }
      currentRotation.current.multiplyQuaternions(quaternionX, currentRotation.current)
      currentRotation.current.multiplyQuaternions(quaternionY, currentRotation.current)
      currentRotation.current.normalize()


      // const windowCenter = new Vector3(window.innerWidth / 2, window.innerHeight / 2, 0)

      // dragEnd.current.set(event.clientX, event.clientY)

      // const dragDistance = dragStart.current.distanceTo(dragEnd.current)
      // console.log(dragDistance)

      // // Normalize the drag distance so that a drag across the entire screen rotates by 360 degrees
      // const rotationAngle = dragDistance / (Math.max(window.innerWidth, window.innerHeight) * 2 * Math.PI)

      // // Create a quaternion representing a rotation around the y axis
      // if (!currentRotation.current) {
      //   currentRotation.current = new Quaternion()
      // }

      // currentRotation.current.setFromAxisAngle(new Vector3(0, 1, 0), rotationAngle)

      // Reset the drag start to the current position
      // dragStart.current.copy(dragEnd.current)
    }

    window.addEventListener("keydown", handleForward)
    window.addEventListener("keydown", handleReverse)
    window.addEventListener("keyup", handleInactive)
    window.addEventListener("pointerdown", handlePointerDown)
    window.addEventListener("pointermove", handlePointerMove)
    
    // set handler for throttle change via scroll wheel
    const handleWheel = (e: WheelEvent) => {
      // e.preventDefault()
      if (e.deltaY > 0) {
        throttle.current = Math.min(10,throttle.current + 1)
      } else {
        throttle.current = Math.max(0,throttle.current - 1)
      }
      console.log("Throttle change:", throttle.current)
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

  // initialize the engine with the latest action chain state
  useEffect(() => {
    if (actionChainState.status === 'valid') {
      setGenesisAction(actionChainState.genesisAction)
      setLatestAction(actionChainState.latestAction)
      engineReadyRef.current = true
    }
  }, [actions, position, velocity, rotation, simulationHeight, actionChainState, setGenesisAction, setLatestAction])

  // update rotation based on pointer drag
  // update camera
  useFrame(() => {
    if (!currentRotation.current) {
      currentRotation.current = rotation.clone()
    }
    const pos = new DecimalVector3().fromArray(position.toArray())
    camera.position.copy(pos.divideScalar(CYBERSPACE_DOWNSCALE).toVector3())
    camera.quaternion.copy(currentRotation.current)
    camera.updateProjectionMatrix()
    // camera.position.x = HALF_DOWNSCALED_CYBERSPACE_AXIS
    // camera.position.y = HALF_DOWNSCALED_CYBERSPACE_AXIS
    // camera.position.z = DOWNSCALED_CYBERSPACE_AXIS
  })

  // functions
  const driftWrapper = (throttle: number, quaternion: Quaternion|null) => {
    if (quaternion) {
      drift(throttle, quaternion)
    }
  }

  const stopDriftWrapper = () => {
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