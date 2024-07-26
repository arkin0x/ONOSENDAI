import React, { useContext, useEffect, useRef, useCallback, useState } from 'react'
import { useThrottleStore } from '../store/ThrottleStore.ts'
import { IdentityContext } from '../providers/IdentityProvider.tsx'
import { IdentityContextType } from '../types/IdentityType.tsx'
import { useEngine } from '../hooks/cyberspace/useEngine.ts'
import { Euler, Quaternion, Vector3 } from 'three'
import { AvatarContext } from '../providers/AvatarContext.tsx'
import { useFrame } from '@react-three/fiber'
import { defaultRelays } from '../libraries/Nostr.ts'
import { useControlStore } from '../store/ControlStore.ts'
import { useRotationStore } from '../store/RotationStore.ts'

export const Controls: React.FC = () => {
  const { identity } = useContext<IdentityContextType>(IdentityContext)
  const pubkey = identity.pubkey
  const engine = useEngine(pubkey, defaultRelays)
  const { actionState } = useContext(AvatarContext)
  const actions = actionState[pubkey]
  const { throttle, setThrottle } = useThrottleStore()
  const { controlState, setControlState, resetControlState } = useControlStore()
  const { setRotation } = useRotationStore()
  const [isDragging, setIsDragging] = useState(false)
  const [lastMousePosition, setLastMousePosition] = useState<{ x: number, y: number } | null>(null)
  const [pitch, setPitch] = useState(0)
  const [yaw, setYaw] = useState(0)

  const isHopping = useRef<boolean>(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (actions && actions.length > 0) {
      engine.setGenesisAction(actions[0])
      engine.setLatestAction(actions[actions.length - 1])
    }
  }, [actions, engine])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    switch (e.code) {
      case "KeyQ":
        setControlState({ rollLeft: true, rollLeftCompleted: false })
        break
      case "KeyE":
        setControlState({ rollRight: true, rollRightCompleted: false })
        break
      case "KeyW":
        setControlState({ forward: true })
        break
      case "KeyS":
        setControlState({ backward: true })
        break
      case "KeyA":
        setControlState({ left: true })
        break
      case "KeyD":
        setControlState({ right: true })
        break
      case "KeyX":
        isHopping.current = !isHopping.current
        console.log(isHopping.current ? "Hopping mode enabled" : "Drifting mode enabled")
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
      case "Escape":
        setControlState({ respawn: true })
        break
    }
  }, [setControlState])

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    switch (e.code) {
      case "KeyQ":
        setControlState({ rollLeft: false, rollLeftCompleted: false })
        break
      case "KeyE":
        setControlState({ rollRight: false, rollRightCompleted: false })
        break
      case "KeyW":
        setControlState({ forward: false })
        break
      case "KeyS":
        setControlState({ backward: false })
        break
      case "KeyA":
        setControlState({ left: false })
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
      case "Escape":
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
    const canvas = document.querySelector('canvas')
    if (canvas) {
      canvas.addEventListener('mouseenter', handleMouseEnter)
      canvas.addEventListener('mouseleave', handleMouseLeave)
    }

    return () => {
      if (canvas) {
        canvas.removeEventListener('mouseenter', handleMouseEnter)
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
    }
  }, [isDragging, lastMousePosition])


  const handleWheel = useCallback((e: WheelEvent) => {
    setThrottle(Math.max(0, Math.min(128, throttle + (e.deltaY > 0 ? 1 : -1))))
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
      canvas.addEventListener('click', () => canvas.requestPointerLock())
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
      engine.respawn()
      resetControlState()
      setPitch(0)
      setYaw(0)
      setRotation(new Quaternion())
      setThrottle(1)
      return
    }

    // Handle roll rotation
    // const rotationChange = Math.PI / 2 // 90 degrees
    // const newRotation = rotation.clone()

    // if (controlState.rollLeft && !controlState.rollLeftCompleted) {
    //   newRotation.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rotationChange).normalize())
    //   setControlState({ rollLeftCompleted: true })
    // }
    // if (controlState.rollRight && !controlState.rollRightCompleted) {
    //   newRotation.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -rotationChange).normalize())
    //   setControlState({ rollRightCompleted: true })
    // }

    // Create a new quaternion from pitch and yaw
    const pitchQuat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch)
    const yawQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw)
    const newRotation = yawQuat.multiply(pitchQuat)

    setRotation(newRotation.normalize())


    // Handle movement
    const moveVector = new Vector3()

    if (controlState.forward) moveVector.z -= 1
    if (controlState.backward) moveVector.z += 1
    if (controlState.left) moveVector.x -= 1
    if (controlState.right) moveVector.x += 1
    if (controlState.up) moveVector.y += 1
    if (controlState.down) moveVector.y -= 1

    // Handle drift/hop
    if (moveVector.lengthSq() > 0) {
      moveVector.normalize()

      // Apply rotation to movement vector
      moveVector.applyQuaternion(newRotation)

      if (isHopping.current) {
        console.log("Hopping in direction:", moveVector)
        // Implement hopping logic here
      } else {
        // Convert the rotated move vector directly to a quaternion
        const movementQuaternion = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), moveVector)
        // console.log("movequat", movementQuaternion.toArray().map((x) => x.toFixed(2)))
        engine.drift(throttle, movementQuaternion)
      }
    } else {
      // If no movement, stop drifting
      // engine.stopDrift()
    }

    // Handle freeze
    if (controlState.freeze) {
      engine.freeze()
    }
  })
  

  return null
}