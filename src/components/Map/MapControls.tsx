import React, { useEffect, useCallback, useState } from 'react'
import { useZoomStore } from '../../store/ZoomStore.ts'
import { Quaternion, Vector3 } from 'three'
import { useFrame } from '@react-three/fiber'
import { useRotationStore } from '../../store/RotationStore.ts'
import { Plane } from '@react-three/drei'

export const MapControls: React.FC = () => {
  const { zoom, setZoom, ZOOM_MAX } = useZoomStore()
  const { setRotation } = useRotationStore()
  const [isDragging, setIsDragging] = useState(false)
  const [lastMousePosition, setLastMousePosition] = useState<{ x: number, y: number } | null>(null)
  const [pitch, setPitch] = useState(0)
  const [yaw, setYaw] = useState(0)

  const handleMouseEnter = useCallback((e: MouseEvent) => {
    setLastMousePosition({ x: e.clientX, y: e.clientY })
  }, [])

  const handleMouseLeave = useCallback(() => {
    setLastMousePosition(null)
  }, [])

  useEffect(() => {
    const canvas = document.querySelector('#map canvas')
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
    }
  }, [isDragging, lastMousePosition])


  const handleWheel = useCallback((e: WheelEvent) => {
    setZoom(Math.max(0, Math.min(ZOOM_MAX, zoom + (e.deltaY > 0 ? 1 : -1))))
  }, [setZoom, zoom])

  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault() // Prevent the default context menu
  }, [])

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mousedown", handleMouseDown)
    window.addEventListener("mouseup", handleMouseUp)
    window.addEventListener("wheel", handleWheel, { passive: true })
    window.addEventListener("contextmenu", handleContextMenu)

    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mousedown", handleMouseDown)
      window.removeEventListener("mouseup", handleMouseUp)
      window.removeEventListener("wheel", handleWheel)
      window.removeEventListener("contextmenu", handleContextMenu)
    }
  }, [handleMouseMove, handleMouseDown, handleMouseUp, handleWheel, handleContextMenu])

  
  useFrame(() => {
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

  })
  

  return null
}
