import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import COLORS from '../../data/Colors'

const SpeedLines: React.FC = () => {
  const { camera, scene } = useThree()
  const speedUIRef = useRef<THREE.Group>(new THREE.Group())

  useEffect(() => {
    const speedLinesNearDist = 8
    const speedLinesFarDist = -10
    const speedLineCount = 2

    const topVec = new THREE.Vector3()
    topVec.copy(camera.position)
    topVec.y += 0.2
    topVec.z = speedLinesFarDist

    const botVec = new THREE.Vector3()
    botVec.copy(camera.position)
    botVec.y -= 0.2
    botVec.z = speedLinesFarDist

    const speedLineHalf = speedLineCount / 2
    const speedLineOffsetStart = 0 - speedLineHalf
    const speedLineOffsetEnd = speedLineCount - speedLineHalf

    for (let i = speedLineOffsetStart; i <= speedLineOffsetEnd; i++) {
      let xoffset = -1
      if (i < 0) xoffset = -1
      if (i === 0) continue
      if (i > 0) xoffset = 1

      const t = new THREE.Vector3()
      t.copy(topVec)
      t.x = xoffset
      t.z += Math.abs(i / 1)

      const b = new THREE.Vector3()
      b.copy(botVec)
      b.x = xoffset
      b.z += Math.abs(i / 1)

      createLine(t, b, speedUIRef.current)
    }

    camera.add(speedUIRef.current)

    return () => {
      camera.remove(speedUIRef.current)
    }
  }, [camera])

  const createLine = (start: THREE.Vector3, end: THREE.Vector3, group: THREE.Group) => {
    const material = new THREE.LineBasicMaterial({ color: COLORS.ORANGE })
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end])
    const line = new THREE.Line(geometry, material)
    group.add(line)
  }

  return null
}

export default SpeedLines