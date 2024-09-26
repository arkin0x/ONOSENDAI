import React from 'react'
import { useFrame, useThree } from "@react-three/fiber"
import { useRef } from "react"
import { Vector3 } from "three"
import { CyberspacePlane, extractCyberspaceActionState, ExtractedCyberspaceActionState } from "../../libraries/Cyberspace"
import { useAvatarStore } from "../../store/AvatarStore"
import COLORS from "../../data/Colors"
import useNDKStore from "../../store/NDKStore"
import { CoordinateText } from "./CoordinateText"

interface SimpleHudProps {
  showSectorInfo?: boolean;
}

export const SimpleHud: React.FC<SimpleHudProps> = ({ showSectorInfo = false }) => {
  const { camera } = useThree()
  const { getUser } = useNDKStore()
  const identity = getUser()
  const { getSimulatedState } = useAvatarStore()

  const pubkey = identity!.pubkey
  const simulatedStateRef = useRef<ExtractedCyberspaceActionState>()

  useFrame(() => {
    const simulated = getSimulatedState(pubkey)
    if (simulated) {
      simulatedStateRef.current = extractCyberspaceActionState(simulated)
    }
  })

  if (!simulatedStateRef.current) return null

  return (
    <group position={camera.position} rotation={camera.rotation}>
      <group position={new Vector3(0, 0, -1)}>
        <CoordinateText position={{x: -0.9, y: 0.8}} rotation={[0, 0, 0]} text={'PLANE ' + simulatedStateRef.current.plane.toUpperCase()} align="left" color={simulatedStateRef.current.plane === CyberspacePlane.DSpace ? COLORS.DSPACE : COLORS.ISPACE} />
        <CoordinateText position={{x: -0.9, y: 0.7}} rotation={[0, 0, 0]} text={'Z: ' + simulatedStateRef.current.localCoordinate.vector.z.toFixed(2)} align="left" />
        <CoordinateText position={{x: -0.9, y: 0.6}} rotation={[0, 0, 0]} text={'Y: ' + simulatedStateRef.current.localCoordinate.vector.y.toFixed(2)} align="left" />
        <CoordinateText position={{x: -0.9, y: 0.5}} rotation={[0, 0, 0]} text={'X: ' + simulatedStateRef.current.localCoordinate.vector.x.toFixed(2)} align="left" />
        
        {showSectorInfo && (
          <>
            <CoordinateText position={{x: -0.9, y: 0.4}} rotation={[0, 0, 0]} text={'SECTOR ID ' + simulatedStateRef.current.sector.id} align="left" />
            <CoordinateText position={{x: -0.9, y: 0.3}} rotation={[0, 0, 0]} text={'COORD ' + simulatedStateRef.current.coordinate.raw.toUpperCase()} align="left" />
          </>
        )}
      </group>
    </group>
  )
}