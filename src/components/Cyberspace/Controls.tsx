import React, { useEffect, useRef, useCallback, useState } from 'react'
import { useThrottleStore } from '../../store/ThrottleStore.ts'
import { Quaternion, Vector3 } from 'three'
import { useAvatarStore } from '../../store/AvatarStore.ts'
import { useFrame } from '@react-three/fiber'
import { useControlStore } from '../../store/ControlStore.ts'
import { useRotationStore } from '../../store/RotationStore.ts'
import { extractCyberspaceActionState } from '../../libraries/Cyberspace.ts'
import useNDKStore from '../../store/NDKStore.ts'
import { useEngineStore } from '../../store/EngineStore.ts'

export const Controls: React.FC = () => {
  const { getUser } = useNDKStore()
  const identity = getUser()
  const pubkey = identity!.pubkey
  // const engine = useEngine(pubkey)
  const { setPubkey, respawn, drift, freeze, hop, stop } = useEngineStore()
  const { getSimulatedState, getLatest } = useAvatarStore()
  const { throttle, setThrottle } = useThrottleStore()
  const { controlState, setControlState, resetControlState } = useControlStore()
  const { setRotation } = useRotationStore()
  const [isDragging, setIsDragging] = useState(false)
  const [lastMousePosition, setLastMousePosition] = useState<{ x: number, y: number } | null>(null)
  const [pitch, setPitch] = useState(0)
  const [yaw, setYaw] = useState(0)
  const [cruiseDirection, setCruiseDirection] = useState<Quaternion>(new Quaternion())
  const simulatedEvent = getSimulatedState(pubkey, true)
  const latestAction = getLatest(pubkey)
  const isHopping = useRef<boolean>(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    setPubkey(pubkey)
  }, [pubkey])

  // get the current direction of travel from the latest action for cruise control
  useEffect(() => {
    if (!latestAction) return
    const { rotation } = extractCyberspaceActionState(latestAction)
    setCruiseDirection(rotation)
  }, [latestAction])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    switch (e.code) {
      case "KeyQ":
        setControlState({ rollLeft: true, rollLeftCompleted: false })
        break
      case "KeyW":
        setControlState({ forward: true })
        break
      case "KeyE":
        setControlState({ rollRight: true, rollRightCompleted: false })
        break
      case "KeyA":
        setControlState({ left: true })
        break
      case "KeyS":
        setControlState({ backward: true })
        break
      case "KeyD":
        setControlState({ right: true })
        break
      case "KeyX":
        isHopping.current = !isHopping.current
        console.log(isHopping.current ? "Hopping mode enabled" : "Drifting mode enabled")
        break
      case "KeyC":
        setControlState({ cruise: !controlState.cruise })
        break
      case "Space":
        setControlState({ up: true })
        break
      case "ShiftLeft":
      case "ShiftRight":
        setControlState({ down: true })
        break
      case "AltLeft":
        setControlState({ freeze: true })
        break
      case "Backspace":
        setControlState({ respawn: true })
        break
      case "Escape":
        setControlState({ resetView: !controlState.resetView})
        break
    }
  }, [controlState, setControlState])

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    switch (e.code) {
      case "KeyQ":
        setControlState({ rollLeft: false, rollLeftCompleted: false })
        break
      case "KeyW":
        setControlState({ forward: false })
        break
      case "KeyE":
        setControlState({ rollRight: false, rollRightCompleted: false })
        break
      case "KeyA":
        setControlState({ left: false })
        break
      case "KeyS":
        setControlState({ backward: false })
        break
      case "KeyD":
        setControlState({ right: false })
        break
      case "Space":
        setControlState({ up: false })
        break
      case "ShiftLeft":
      case "ShiftRight":
        setControlState({ down: false })
        break
      case "AltLeft":
        setControlState({ freeze: false })
        break
      case "Backspace":
        setControlState({ respawn: false })
        break
    }
  }, [setControlState])

  const handleMouseEnter = useCallback((e: MouseEvent) => {
    setLastMousePosition({ x: e.clientX, y: e.clientY })
  }, [])

  const handleMouseLeave = useCallback(() => {
    setLastMousePosition(null)
  }, [])

  useEffect(() => {
    const canvas = document.querySelector('#cyberspace canvas')
    if (canvas) {
      canvas.addEventListener('mouseenter', handleMouseEnter as EventListener)
      canvas.addEventListener('mouseleave', handleMouseLeave)
    }

    return () => {
      if (canvas) {
        canvas.removeEventListener('mouseenter', handleMouseEnter as EventListener)
        canvas.removeEventListener('mouseleave', handleMouseLeave)
      }
    }
  }, [handleMouseEnter, handleMouseLeave]) 

  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (e.button === 2) { // Right mouse button
      console.log("Action menu opened")
      // Implement action menu logic here
    } else if (e.button === 0) { // Left mouse button
      setIsDragging(true)
      setLastMousePosition({ x: e.clientX, y: e.clientY })
    }
  }, [])

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (e.button === 0) { // Left mouse button
      setIsDragging(false)
      setLastMousePosition(null)
    }
  }, [])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging && lastMousePosition) {
      const sensitivity = 0.003
      const deltaX = e.clientX - lastMousePosition.x
      const deltaY = e.clientY - lastMousePosition.y

      // Update yaw and pitch
      setYaw((prevYaw) => prevYaw - deltaX * sensitivity)
      setPitch((prevPitch) => {
        // Clamp pitch to avoid flipping
        return prevPitch + deltaY * sensitivity
      })

      setLastMousePosition({ x: e.clientX, y: e.clientY })

      // Reset the resetView state when the user starts dragging
      setControlState({ resetView: false })
    }
  }, [isDragging, lastMousePosition, setControlState])


  const handleWheel = useCallback((e: WheelEvent) => {
    setThrottle(Math.max(0, Math.min(128, throttle + (e.deltaY < 0 ? 1 : -1))))
  }, [setThrottle, throttle])

  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault() // Prevent the default context menu
  }, [])

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mousedown", handleMouseDown)
    window.addEventListener("mouseup", handleMouseUp)
    window.addEventListener("wheel", handleWheel)
    window.addEventListener("contextmenu", handleContextMenu)

    const canvas = document.querySelector('canvas')
    if (canvas) {
      canvasRef.current = canvas
      // canvas.addEventListener('click', () => canvas.requestPointerLock())
    }

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mousedown", handleMouseDown)
      window.removeEventListener("mouseup", handleMouseUp)
      window.removeEventListener("wheel", handleWheel)
      window.removeEventListener("contextmenu", handleContextMenu)
    }
  }, [handleKeyDown, handleKeyUp, handleMouseMove, handleMouseDown, handleMouseUp, handleWheel, handleContextMenu])

  
  useFrame(() => {
    if (controlState.respawn) {
      respawn()
      resetControlState()
      setPitch(0)
      setYaw(0)
      setRotation(new Quaternion())
      setThrottle(1)
      return
    }

    let newRotation = new Quaternion()

    if (controlState.resetView) {
      if (simulatedEvent) {
        const { velocity } = extractCyberspaceActionState(simulatedEvent)
        const directionOfTravel = velocity.toVector3().normalize()

        // Invert the direction to place the camera behind the avatar
        const cameraDirection = directionOfTravel.clone().negate()

        // Reset pitch and yaw based on the direction of travel
        newRotation = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), cameraDirection)
        
        setRotation(newRotation)
        // setPitch(0)
        // setYaw(0)

      } else {
        setRotation(new Quaternion())
        setPitch(0)
        setYaw(0)
      }
    } else {
      // Create a new quaternion from pitch and yaw
      const pitchQuat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch)
      const yawQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw)
      newRotation = yawQuat.multiply(pitchQuat)

      setRotation(newRotation.normalize())
    }

    // Handle movement
    const moveVector = new Vector3()

    if (controlState.forward || controlState.cruise) moveVector.z -= 1
    if (controlState.backward) moveVector.z += 1
    if (controlState.left) moveVector.x -= 1
    if (controlState.right) moveVector.x += 1
    if (controlState.up) moveVector.y -= 1
    if (controlState.down) moveVector.y += 1

    // Handle drift/hop
    if (moveVector.lengthSq() > 0) {
      moveVector.normalize()

      // Apply rotation to movement vector
      moveVector.applyQuaternion(newRotation as Quaternion)

      if (isHopping.current) {
        console.log("Hopping in direction:", moveVector)
        // Implement hopping logic here
      } else {
        // Convert the rotated move vector directly to a quaternion
        const movementQuaternion = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), moveVector)
        // console.log("movequat", movementQuaternion.toArray().map((x) => x.toFixed(2)))
        if (controlState.cruise) {
          drift(cruiseDirection)
        } else {
          drift(movementQuaternion)
        }
      }
    } else {
      // If no movement, stop drifting
      stop()
    }

    // Handle freeze
    // if (controlState.freeze) {
    //   freeze()
    // }
  })
  

  return null
}

