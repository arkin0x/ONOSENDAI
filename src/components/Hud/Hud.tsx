import { useFrame } from "@react-three/fiber"
import { useRef, useState, useEffect, useMemo } from "react"
import { CyberspacePlane, cyberspaceVelocityToMAG, extractCyberspaceActionState, ExtractedCyberspaceActionState } from "../../libraries/Cyberspace"
import { useThrottleStore } from "../../store/ThrottleStore"
import { useControlStore } from "../../store/ControlStore"
import { useRotationStore } from "../../store/RotationStore"
import { useAvatarStore } from "../../store/AvatarStore"
import { useSectorStore } from "../../store/SectorStore"
import COLORS from "../../data/Colors"
import { generateSectorName } from "../../libraries/SectorName"
import useNDKStore from "../../store/NDKStore"
import { CoordinateText } from "./CoordinateText"

export const Hud = () => {
  const { getUser } = useNDKStore()
  const identity = getUser()
  const { actionState, getSimulatedState } = useAvatarStore()
  const { throttle } = useThrottleStore()
  const { controlState } = useControlStore()
  const { rotation } = useRotationStore()
  const { userCurrentSectorId, sectorState } = useSectorStore()
  const [genesis, setGenesis] = useState<boolean>(false)
  const [hyperjump, setHyperjump] = useState<boolean>(false)

  const pubkey = identity!.pubkey
  const actionsRef = useRef(actionState[pubkey])

  const windowWidth = window.innerWidth
  const divisor = Math.max(4, Math.floor(windowWidth / 600))
  const r = Math.PI / divisor // rotation
  const simulatedStateRef = useRef<ExtractedCyberspaceActionState>()

  useFrame(() => {
    const simulated = getSimulatedState(pubkey)
    if (simulated) {
      simulatedStateRef.current = extractCyberspaceActionState(simulated)
    }
    actionsRef.current = actionState[pubkey]
  })

  useEffect(() => {
    if (userCurrentSectorId) {
      setGenesis(sectorState[userCurrentSectorId].isGenesis)
      setHyperjump(sectorState[userCurrentSectorId].hyperjumps.length > 0)
    }
  }, [userCurrentSectorId, sectorState])

  const nextLine = useMemo(() => {
    let line = 0
    return () => {
      line += 2
      return line
    }
  }, [])

  if (!simulatedStateRef.current) return null
  if (!actionsRef.current) return null

  return (
    <>
      <group>
        {/* Left-side HUD items */}
        <CoordinateText position={{x: 1, y: nextLine()}} rotation={[0, r, 0]} text={'PLANE ' + simulatedStateRef.current.plane.toUpperCase()} align="left" color={simulatedStateRef.current.plane === CyberspacePlane.DSpace ? COLORS.DSPACE : COLORS.ISPACE} />
        <CoordinateText position={{x: 1, y: nextLine()}} rotation={[0, r, 0]} text={'Z: ' + simulatedStateRef.current.localCoordinate.vector.z.toFixed(2)} align="left" />
        <CoordinateText position={{x: 1, y: nextLine()}} rotation={[0, r, 0]} text={'Y: ' + simulatedStateRef.current.localCoordinate.vector.y.toFixed(2)} align="left" />
        <CoordinateText position={{x: 1, y: nextLine()}} rotation={[0, r, 0]} text={'X: ' + simulatedStateRef.current.localCoordinate.vector.x.toFixed(2)} align="left" />
        <CoordinateText position={{x: 1, y: nextLine()}} rotation={[0, r, 0]} text={generateSectorName(simulatedStateRef.current.sector.id).toUpperCase()} align="left" />
        <CoordinateText position={{x: 1, y: nextLine()}} rotation={[0, r, 0]} text={'SECTOR ID ' + simulatedStateRef.current.sector.id} align="left" />
        <CoordinateText position={{x: 1, y: nextLine()}} rotation={[0, r, 0]} text={'COORD ' + simulatedStateRef.current.coordinate.raw.toUpperCase()} align="left" />
        <CoordinateText position={{x: 1, y: nextLine()}} rotation={[0, r, 0]} text={`Z VELOCITY ${simulatedStateRef.current.velocity.z.mul(60).toFixed(2)} G/s`} align="left" color={COLORS.ORANGE} />
        <CoordinateText position={{x: 1, y: nextLine()}} rotation={[0, r, 0]} text={`Y VELOCITY ${simulatedStateRef.current.velocity.y.mul(60).toFixed(2)} G/s`} align="left" color={COLORS.ORANGE} />
        <CoordinateText position={{x: 1, y: nextLine()}} rotation={[0, r, 0]} text={`X VELOCITY ${simulatedStateRef.current.velocity.x.mul(60).toFixed(2)} G/s`} align="left" color={COLORS.ORANGE} />
        <CoordinateText position={{x: 1, y: nextLine()}} rotation={[0, r, 0]} text={`MAG ${cyberspaceVelocityToMAG(simulatedStateRef.current.velocity).toFixed(2)}`} align="left" color={COLORS.ORANGE} />

        { rotation && <CoordinateText position={{x: 1, y: nextLine()}} rotation={[0, r, 0]} text={'QUATERNION ' + rotation.x.toFixed(2) + '/' + rotation.y.toFixed(2) + '/' + rotation.z.toFixed(2) + '/' + rotation.w.toFixed(2)} align="left" color={COLORS.ORANGE} /> }

        <CoordinateText position={{x: 1, y: nextLine()}} rotation={[0, r, 0]} text={'THROTTLE ' + throttle + ' ' + '/'.repeat(throttle) + ' +' + (throttle === 0 ? 0 : Math.pow(2, throttle-10) * 60) + ' G/s'} align="left" color={COLORS.RED} />

        <CoordinateText position={{x: 1, y: nextLine()}} rotation={[0, r, 0]} text={'CHAIN LENGTH ' + actionsRef.current.length} align="left" color={COLORS.PURPLE} />

        { controlState.cruise 
          ? <CoordinateText position={{x: 1, y: nextLine()}} rotation={[0, r, 0]} text={'CRUISE ENGAGED'} align="left" color={COLORS.PINK} /> 
          : <CoordinateText position={{x: 1, y: nextLine()}} rotation={[0, r, 0]} text={'PRESS C FOR CRUISE'} align="left" color={COLORS.PURPLE} />  
        }

        <CoordinateText position={{x: 1, y: 95}} rotation={[0, r, 0]} text={'PRESS T FOR TELEMETRY'} align="left" color={COLORS.PURPLE} fontSize={0.10} /> 

        {/* Right-side HUD items */}
        {genesis && (
          <CoordinateText position={{x: 99, y: nextLine()}} rotation={[0, -r, 0]} text={'GENESIS SECTOR'} align="right" color={COLORS.PINK} />
        )}
        {hyperjump && (
          <CoordinateText position={{x: 99, y: nextLine()}} rotation={[0, -r, 0]} text={'LOCAL HYPERJUMP'} align="right" color={COLORS.YELLOW} />
        )}
      </group>
    </>
  )
}